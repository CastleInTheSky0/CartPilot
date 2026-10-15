import { createActor, fromPromise, setup } from "xstate";
import {
  PreparedTaskSchema,
  ExecutionOutcomeSchema,
  TaskPhaseSchema,
  type PreparedTask,
} from "../../../shared/contracts/task-execution.ts";
import type { PurchaseStore } from "../../application/purchase-store.ts";
import type { TaskExecutionPort, TaskPreparationPort } from "../../application/task-execution.ts";
import { PurchaseError } from "../../domain/purchase-error.ts";

interface Options {
  purchases: PurchaseStore;
  preparation: TaskPreparationPort;
  execution: TaskExecutionPort;
  now?: () => number;
  clock?: NonNullable<Parameters<typeof createActor>[1]>["clock"];
}

export function createTaskController(taskId: string, options: Options) {
  const { purchases } = options;
  const task = purchases.getTask(taskId);
  const now = options.now ?? Date.now;
  let plan: PreparedTask | null = null;
  let runId: string | null = null;
  let reason = "需要重新读取页面并准备任务。";
  const hasValidPlan = () => plan !== null && Date.parse(plan.validUntil) > now();
  const endRun = () => {
    if (runId) purchases.stopRun(runId);
    runId = null;
  };
  const machine = setup({
    actors: {
      prepare: fromPromise(async ({ signal }) => {
        const result = PreparedTaskSchema.parse(await options.preparation.prepare(task, signal));
        signal.throwIfAborted();
        if (
          result.taskId !== taskId ||
          result.candidateIds.some(
            (id) => !task.definition.candidates.some((candidate) => candidate.id === id),
          ) ||
          Date.parse(result.validUntil) <= now() ||
          Date.parse(result.preparedAt) > now() + 5000 ||
          Date.parse(result.preparedAt) > Date.parse(result.validUntil)
        )
          throw new PurchaseError("invalid_plan", "准备结果与任务不符或已经过期。");
        return result;
      }),
      execute: fromPromise(async ({ signal }) => {
        signal.throwIfAborted();
        if (!plan || !hasValidPlan()) throw new PurchaseError("plan_expired", "执行计划已过期。");
        const run = purchases.startRun(taskId);
        runId = run.id;
        return ExecutionOutcomeSchema.parse(
          await options.execution.execute(task, run, plan, signal),
        );
      }),
    },
    guards: {
      isComplete: () => purchases.progress(taskId).isComplete,
      hasValidPlan,
      isDue: () => Date.parse(task.definition.schedule.launchAt) <= now(),
    },
    delays: {
      untilSale: () =>
        Math.min(86_400_000, Math.max(0, Date.parse(task.definition.schedule.launchAt) - now())),
      untilPlanExpires: () =>
        Math.min(86_400_000, Math.max(0, Date.parse(plan?.validUntil ?? "") - now())),
      maximumDuration: () => task.definition.schedule.maxRunMinutes * 60_000,
    },
    actions: {
      discardPlan: () => {
        plan = null;
      },
      stopRun: endRun,
      stopped: () => {
        reason = "任务已停止，已有订单与未决占用继续保留。";
      },
      expired: () => {
        plan = null;
        reason = "页面或计划已变化，请重新准备。";
      },
    },
  }).createMachine({
    id: "purchase-task",
    initial: purchases.progress(taskId).isComplete ? "completed" : "review_required",
    on: {
      STOP: { target: ".stopped", actions: ["discardPlan", "stopped"] },
      INVALIDATE: { target: ".review_required", actions: "expired" },
    },
    states: {
      review_required: { on: { PREPARE: "preparing" } },
      preparing: {
        invoke: {
          src: "prepare",
          onDone: {
            target: "ready",
            actions: ({ event }) => {
              plan = PreparedTaskSchema.parse(event.output);
              reason = "任务已准备，可启动等待开售。";
            },
          },
          onError: {
            target: "error",
            actions: ({ event }) => {
              reason = event.error instanceof Error ? event.error.message : "准备失败。";
            },
          },
        },
      },
      ready: {
        on: {
          START: [
            { guard: "isComplete", target: "completed" },
            { guard: "hasValidPlan", target: "scheduled" },
            { target: "review_required", actions: "expired" },
          ],
          PREPARE: "preparing",
        },
      },
      scheduled: {
        always: [
          {
            guard: () => !hasValidPlan(),
            target: "review_required",
            actions: "expired",
          },
          { guard: "isDue", target: "running" },
        ],
        after: {
          untilSale: { target: "scheduled", reenter: true },
          untilPlanExpires: { target: "scheduled", reenter: true },
        },
      },
      running: {
        exit: "stopRun",
        after: {
          maximumDuration: { target: "stopped", actions: ["discardPlan", "stopped"] },
          untilPlanExpires: { target: "review_required", actions: "expired" },
        },
        invoke: {
          src: "execute",
          onDone: [
            {
              guard: "isComplete",
              target: "completed",
              actions: () => {
                reason = "任务目标已完成，支付请在浏览器处理。";
              },
            },
            {
              guard: ({ event }) => ExecutionOutcomeSchema.parse(event.output).kind === "cooldown",
              target: "cooldown",
              actions: ({ event }) => {
                reason = ExecutionOutcomeSchema.parse(event.output).reason;
              },
            },
            {
              target: "awaiting_user",
              actions: ({ event }) => {
                reason = ExecutionOutcomeSchema.parse(event.output).reason;
              },
            },
          ],
          onError: {
            target: "error",
            actions: ({ event }) => {
              reason =
                event.error instanceof Error ? event.error.message : "执行异常，未决记录继续保留。";
            },
          },
        },
      },
      awaiting_user: { on: { PREPARE: "preparing" } },
      cooldown: { on: { PREPARE: "preparing" } },
      stopped: { on: { PREPARE: "preparing" } },
      completed: { type: "final" },
      error: { on: { PREPARE: "preparing" } },
    },
  });
  const actor = createActor(machine, options.clock ? { clock: options.clock } : undefined);
  actor.start();
  const snapshot = () => ({
    taskId,
    phase: TaskPhaseSchema.parse(actor.getSnapshot().value),
    reason,
    runId,
    progress: purchases.progress(taskId),
  });
  return {
    snapshot,
    prepare(): void {
      if (!actor.getSnapshot().can({ type: "PREPARE" }))
        throw new PurchaseError("cannot_prepare", "请先停止当前执行再重新准备。");
      actor.send({ type: "PREPARE" });
    },
    start(): void {
      if (!actor.getSnapshot().can({ type: "START" }))
        throw new PurchaseError("not_prepared", "任务尚未准备，请先读取真实页面。");
      actor.send({ type: "START" });
    },
    stop: () => actor.send({ type: "STOP" }),
    invalidate: () => actor.send({ type: "INVALIDATE" }),
    subscribe(listener: (state: ReturnType<typeof snapshot>) => void) {
      const subscription = actor.subscribe(() => listener(snapshot()));
      return () => subscription.unsubscribe();
    },
    dispose(): void {
      actor.send({ type: "STOP" });
      actor.stop();
    },
  };
}
