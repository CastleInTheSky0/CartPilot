import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";
import { SimulatedClock } from "xstate";
import { createTaskController } from "../../src/main/automation/machines/task-controller.ts";
import type { PreparedTask, TaskPhase } from "../../src/shared/contracts/task-execution.ts";
import type {
  TaskExecutionPort,
  TaskPreparationPort,
} from "../../src/main/application/task-execution.ts";
import { checkoutEvidence, reservation, storageFixture } from "./purchase-storage-fixture.ts";

type Controller = ReturnType<typeof createTaskController>;

function waitForPhase(controller: Controller, phase: TaskPhase): Promise<void> {
  if (controller.snapshot().phase === phase) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`未进入 ${phase}，当前 ${controller.snapshot().phase}`));
    }, 3000);
    const unsubscribe = controller.subscribe((state) => {
      if (state.phase === phase) {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      }
    });
  });
}

function controllerFixture(
  context: TestContext,
  execution: TaskExecutionPort,
  overrides: {
    saleDelay?: number;
    validFor?: number;
    preparation?: TaskPreparationPort;
  } = {},
) {
  const baseTime = Date.now();
  const clock = new SimulatedClock();
  const now = () => baseTime + clock.now();
  const fixture = storageFixture(context, {
    allowPartial: true,
    schedule: {
      launchAt: new Date(baseTime + (overrides.saleDelay ?? 0)).toISOString(),
      maxRunMinutes: 1,
    },
  });
  fixture.purchases.stopRun(fixture.run.id);
  const preparation: TaskPreparationPort = overrides.preparation ?? {
    async prepare(task) {
      return {
        taskId: task.id,
        preparedAt: new Date(now()).toISOString(),
        validUntil: new Date(now() + (overrides.validFor ?? 120_000)).toISOString(),
        candidateIds: task.definition.candidates.map((candidate) => candidate.id),
      };
    },
  };
  const controller = createTaskController(fixture.task.id, {
    purchases: fixture.purchases,
    execution,
    preparation,
    clock,
    now,
  });
  return { ...fixture, controller, clock };
}

test("状态机要求先准备，等待开售期间停止后取消定时执行", async (context) => {
  let executions = 0;
  const { controller, clock } = controllerFixture(
    context,
    {
      async execute() {
        executions++;
        return { kind: "exhausted", reason: "无可执行候选" };
      },
    },
    { saleDelay: 10_000 },
  );
  try {
    assert.throws(() => controller.start(), { code: "not_prepared" });
    controller.prepare();
    await waitForPhase(controller, "ready");
    controller.start();
    assert.equal(controller.snapshot().phase, "scheduled");
    clock.increment(9999);
    assert.equal(executions, 0);
    controller.stop();
    clock.increment(1);
    assert.equal(controller.snapshot().phase, "stopped");
    assert.equal(executions, 0);
  } finally {
    controller.dispose();
  }
});

test("准备取消会传递 AbortSignal，过期的异步结果不能恢复任务", async (context) => {
  let finish: (plan: PreparedTask) => void = () => {};
  let preparationSignal: AbortSignal | undefined;
  const { controller, task } = controllerFixture(
    context,
    {
      async execute() {
        throw new Error("不应执行");
      },
    },
    {
      preparation: {
        prepare(_task, signal) {
          preparationSignal = signal;
          return new Promise((resolve) => {
            finish = resolve;
          });
        },
      },
    },
  );
  try {
    controller.prepare();
    assert.equal(controller.snapshot().phase, "preparing");
    controller.stop();
    assert.equal(preparationSignal?.aborted, true);
    finish({
      taskId: task.id,
      preparedAt: new Date().toISOString(),
      validUntil: new Date(Date.now() + 100_000).toISOString(),
      candidateIds: task.definition.candidates.map((candidate) => candidate.id),
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(controller.snapshot().phase, "stopped");
  } finally {
    controller.dispose();
  }
});

test("开售前计划过期取消执行，重新准备后才允许启动", async (context) => {
  let executions = 0;
  const { controller, clock } = controllerFixture(
    context,
    {
      async execute() {
        executions++;
        return { kind: "paused", reason: "需要验证" };
      },
    },
    { saleDelay: 10_000, validFor: 5000 },
  );
  try {
    controller.prepare();
    await waitForPhase(controller, "ready");
    controller.start();
    clock.increment(5000);
    assert.equal(controller.snapshot().phase, "review_required");
    clock.increment(5000);
    assert.equal(executions, 0);
    assert.throws(() => controller.start(), { code: "not_prepared" });
  } finally {
    controller.dispose();
  }
});

test("执行期间停止保留未决占用，已取消执行器不能再取得提交授权", async (context) => {
  let runId = "";
  let intentId = "";
  let executionSignal: AbortSignal | undefined;
  let fixture: ReturnType<typeof controllerFixture>;
  fixture = controllerFixture(context, {
    async execute(task, run, _plan, signal) {
      runId = run.id;
      executionSignal = signal;
      const request = reservation(task, run.id);
      intentId = request.intentId;
      fixture.purchases.reserve(request);
      fixture.purchases.beginSubmission(request.intentId, request.evidence);
      return new Promise((resolve) =>
        signal.addEventListener("abort", () => resolve({ kind: "paused", reason: "已取消" }), {
          once: true,
        }),
      );
    },
  });
  const { controller, purchases, task } = fixture;
  try {
    controller.prepare();
    await waitForPhase(controller, "ready");
    controller.start();
    await waitForPhase(controller, "running");
    assert.throws(() => controller.prepare(), { code: "cannot_prepare" });
    controller.stop();
    assert.equal(executionSignal?.aborted, true);
    assert.equal(purchases.progress(task.id).heldQuantity, 2);
    assert.equal(
      purchases.listIntents(task.id).find((intent) => intent.id === intentId)?.status,
      "pending",
    );
    assert.throws(() => purchases.reserve(reservation(task, runId, 1)), { code: "run_inactive" });
  } finally {
    controller.dispose();
  }
});

test("完成状态以持久化件数为准，执行器返回结束不等于目标完成", async (context) => {
  const { controller } = controllerFixture(context, {
    async execute() {
      return { kind: "exhausted", reason: "剩余数量需人工核对" };
    },
  });
  try {
    controller.prepare();
    await waitForPhase(controller, "ready");
    controller.start();
    await waitForPhase(controller, "awaiting_user");
    assert.equal(controller.snapshot().progress.confirmedQuantity, 0);
    assert.equal(controller.snapshot().reason, "剩余数量需人工核对");
    assert.throws(() => controller.start(), { code: "not_prepared" });
  } finally {
    controller.dispose();
  }
});

test("2 加 1 多笔订单完成后状态机显示目标完成，支付状态独立", async (context) => {
  let fixture: ReturnType<typeof controllerFixture>;
  fixture = controllerFixture(context, {
    async execute(task, run) {
      for (const [index, quantity] of [2, 1].entries()) {
        const evidence = checkoutEvidence(task, index, {
          quantity,
          payableTotalCents: 40_000 * quantity + 1000,
        });
        const request = reservation(task, run.id, index, { evidence });
        fixture.purchases.reserve(request);
        const permit = fixture.purchases.beginSubmission(request.intentId, evidence);
        fixture.purchases.confirm({
          intentId: request.intentId,
          submissionId: permit.submissionId,
          orderNumber: `ORDER${index}`,
          evidence,
          paymentStatus: "unpaid",
        });
      }
      return { kind: "exhausted", reason: "候选已结束" };
    },
  });
  const { controller, purchases, task } = fixture;
  try {
    controller.prepare();
    await waitForPhase(controller, "ready");
    controller.start();
    await waitForPhase(controller, "completed");
    assert.equal(controller.snapshot().progress.confirmedQuantity, 3);
    assert.deepEqual(
      purchases.listOrders(task.id).map((order) => order.paymentStatus),
      ["unpaid", "unpaid"],
    );
    controller.stop();
    assert.equal(controller.snapshot().phase, "completed");
  } finally {
    controller.dispose();
  }
});

test("准备结果不能冒用其他任务或候选身份", async (context) => {
  const { controller } = controllerFixture(
    context,
    {
      async execute() {
        throw new Error("不应执行");
      },
    },
    {
      preparation: {
        async prepare() {
          return {
            taskId: randomUUID(),
            preparedAt: new Date().toISOString(),
            validUntil: new Date(Date.now() + 100_000).toISOString(),
            candidateIds: [randomUUID()],
          };
        },
      },
    },
  );
  try {
    controller.prepare();
    await waitForPhase(controller, "error");
    assert.match(controller.snapshot().reason, /准备结果/);
    assert.throws(() => controller.start(), { code: "not_prepared" });
  } finally {
    controller.dispose();
  }
});
