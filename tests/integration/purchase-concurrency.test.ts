import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import { z } from "zod";
import type { ReservePurchase } from "../../src/shared/contracts/purchase-order.ts";
import { purchaseDefinition } from "../unit/purchase-fixture.ts";
import { checkoutEvidence, reservation, storageFixture } from "./purchase-storage-fixture.ts";

async function competingReservation(databasePath: string) {
  const worker = fork(resolve("tests/fixtures/reservation-worker.ts"), [databasePath], {
    execArgv: ["--import", "tsx"],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["ignore", "ignore", "inherit", "ipc"],
    windowsHide: true,
  });
  const resultSchema = z.discriminatedUnion("status", [
    z.object({ status: z.literal("reserved") }),
    z.object({ status: z.literal("rejected"), code: z.string() }),
  ]);
  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  let settled = false;
  const result = new Promise<z.infer<typeof resultSchema>>((resolve, reject) => {
    worker.on("message", (input: unknown) => {
      if (z.object({ status: z.literal("ready") }).safeParse(input).success) resolveReady();
      else {
        const parsed = resultSchema.safeParse(input);
        settled = true;
        if (parsed.success) resolve(parsed.data);
        else reject(parsed.error);
      }
    });
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (!settled) reject(new Error(`并发测试进程提前退出：${code}`));
    });
  });
  return { worker, ready, result, start: (input: ReservePurchase) => worker.send(input) };
}

test(
  "两个独立进程同时争用最后一件，数据库事务只允许一份预留",
  { timeout: 20_000 },
  async (context) => {
    const { purchases, store, task, run } = storageFixture(context, {
      orderQuantity: 1,
      quantityPlan: { mode: "total", targetQuantity: 1 },
    });
    const workers = await Promise.all([
      competingReservation(store.status().databasePath),
      competingReservation(store.status().databasePath),
    ]);
    context.after(() => {
      for (const { worker } of workers) if (worker.exitCode === null) worker.kill();
    });
    await Promise.all(workers.map((worker) => worker.ready));
    workers.forEach((worker, index) => worker.start(reservation(task, run.id, index)));
    const results = await Promise.all(workers.map((worker) => worker.result));
    assert.equal(results.filter((result) => result.status === "reserved").length, 1);
    assert.deepEqual(
      results.filter((result) => result.status === "rejected").map((result) => result.code),
      ["quota_exhausted"],
    );
    assert.equal(purchases.progress(task.id).heldQuantity, 1);
  },
);

test("两个独立进程同时争用总预算，平台配额独立也不能超支", { timeout: 20_000 }, async (context) => {
  const { purchases, store, task, run } = storageFixture(context, {
    orderQuantity: 1,
    quantityPlan: {
      mode: "per_platform",
      targets: [
        { platform: "jd", quantity: 1 },
        { platform: "tmall", quantity: 1 },
      ],
    },
    budget: { currency: "CNY", maxUnitPriceCents: 50_000, totalBudgetCents: 60_000 },
  });
  const workers = await Promise.all([
    competingReservation(store.status().databasePath),
    competingReservation(store.status().databasePath),
  ]);
  context.after(() => {
    for (const { worker } of workers) if (worker.exitCode === null) worker.kill();
  });
  await Promise.all(workers.map((worker) => worker.ready));
  workers.forEach((worker, index) => worker.start(reservation(task, run.id, index)));
  const results = await Promise.all(workers.map((worker) => worker.result));
  assert.equal(results.filter((result) => result.status === "reserved").length, 1);
  assert.deepEqual(
    results.filter((result) => result.status === "rejected").map((result) => result.code),
    ["budget_exceeded"],
  );
  assert.equal(purchases.progress(task.id).heldCents, 41_000);
});

test("多个商品任务独立计数，共用标签页及淘宝天猫账户资源互斥", (context) => {
  const { purchases, task, run } = storageFixture(context, { orderQuantity: 1 });
  const first = reservation(task, run.id);
  purchases.reserve(first);
  const other = purchases.createTask(purchaseDefinition({ orderQuantity: 1 }));
  const otherRun = purchases.startRun(other.id);
  const sameTab = reservation(other, otherRun.id, 1, { resources: first.resources });
  assert.throws(() => purchases.reserve(sameTab), { code: "resource_busy" });
  assert.equal(purchases.progress(other.id).heldQuantity, 0);
  const separateTab = reservation(other, otherRun.id, 1);
  purchases.reserve(separateTab);
  assert.equal(purchases.progress(other.id).heldQuantity, 1);
  assert.equal(purchases.progress(task.id).heldQuantity, 1);
  const taobaoDefinition = purchaseDefinition({ orderQuantity: 1 });
  taobaoDefinition.candidates = [
    {
      ...taobaoDefinition.candidates[0],
      platform: "taobao",
      productId: "789",
      productUrl: "https://item.taobao.com/item.htm?id=789",
    },
  ];
  const taobaoTask = purchases.createTask(taobaoDefinition);
  const taobaoRun = purchases.startRun(taobaoTask.id);
  assert.throws(() => purchases.reserve(reservation(taobaoTask, taobaoRun.id)), {
    code: "resource_busy",
  });
  purchases.releaseReservation(separateTab.intentId);
  purchases.reserve(reservation(taobaoTask, taobaoRun.id));
  assert.equal(purchases.progress(taobaoTask.id).heldQuantity, 1);
});

test("同平台订单号跨任务去重，新任务不能复用旧订单增加进度", (context) => {
  const { purchases, task, run } = storageFixture(context, { orderQuantity: 1 });
  const first = reservation(task, run.id);
  purchases.reserve(first);
  const permit = purchases.beginSubmission(first.intentId, first.evidence);
  purchases.confirm({
    intentId: first.intentId,
    submissionId: permit.submissionId,
    orderNumber: "JD123456",
    evidence: first.evidence,
    paymentStatus: "unpaid",
  });
  const other = purchases.createTask(purchaseDefinition({ orderQuantity: 1 }));
  const otherRun = purchases.startRun(other.id);
  const second = reservation(other, otherRun.id);
  purchases.reserve(second);
  const nextPermit = purchases.beginSubmission(second.intentId, second.evidence);
  assert.throws(
    () =>
      purchases.confirm({
        intentId: second.intentId,
        submissionId: nextPermit.submissionId,
        orderNumber: "JD123456",
        evidence: second.evidence,
        paymentStatus: "unpaid",
      }),
    { code: "order_reused" },
  );
  assert.equal(purchases.progress(other.id).confirmedQuantity, 0);
  assert.equal(purchases.listIntents(other.id)[0].status, "pending");
});

test("分平台完成只阻止该平台，开启减量后可按 2 加 1 完成原目标", (context) => {
  const { purchases, task, run } = storageFixture(context, {
    allowPartial: true,
    quantityPlan: {
      mode: "per_platform",
      targets: [
        { platform: "jd", quantity: 2 },
        { platform: "tmall", quantity: 1 },
      ],
    },
  });
  const first = reservation(task, run.id);
  purchases.reserve(first);
  const permit = purchases.beginSubmission(first.intentId, first.evidence);
  purchases.confirm({
    intentId: first.intentId,
    submissionId: permit.submissionId,
    orderNumber: "JD123456",
    evidence: first.evidence,
    paymentStatus: "unpaid",
  });
  assert.throws(() => purchases.reserve(reservation(task, run.id)), { code: "quota_exhausted" });
  const second = reservation(task, run.id, 1, {
    evidence: checkoutEvidence(task, 1, { quantity: 1, payableTotalCents: 41_000 }),
  });
  purchases.reserve(second);
  const secondPermit = purchases.beginSubmission(second.intentId, second.evidence);
  purchases.confirm({
    intentId: second.intentId,
    submissionId: secondPermit.submissionId,
    orderNumber: "TM123456",
    evidence: second.evidence,
    paymentStatus: "unpaid",
  });
  assert.equal(purchases.progress(task.id).isComplete, true);
  assert.equal(purchases.progress(task.id).confirmedQuantity, 3);
  purchases.stopRun(run.id);
  assert.throws(() => purchases.startRun(task.id), { code: "target_complete" });
});
