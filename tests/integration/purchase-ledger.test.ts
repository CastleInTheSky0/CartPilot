import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { openDesktopStore } from "../../src/main/infrastructure/storage/desktop-store.ts";
import { purchaseDefinition } from "../unit/purchase-fixture.ts";
import { checkoutEvidence, reservation, storageFixture } from "./purchase-storage-fixture.ts";

test("事务预留避免跨平台超配额，未知订单保留数量和含运费预算", (context) => {
  const { purchases, task, run } = storageFixture(context, { orderQuantity: 1 });
  const first = reservation(task, run.id);
  purchases.reserve(first);
  const permit = purchases.beginSubmission(first.intentId, first.evidence);
  assert.equal(permit.mode, "manual");
  assert.throws(() => purchases.beginSubmission(first.intentId, first.evidence), {
    code: "already_submitted",
  });
  assert.throws(() => purchases.releaseReservation(first.intentId), { code: "cannot_release" });
  const progress = purchases.progress(task.id);
  assert.equal(progress.confirmedQuantity, 0);
  assert.equal(progress.remainingQuantity, 2);
  assert.equal(progress.remainingBudgetCents, 109_000);
  const second = reservation(task, run.id, 1, {
    evidence: checkoutEvidence(task, 1, { quantity: 3 }),
  });
  assert.throws(() => purchases.reserve(second), { code: "quantity_mismatch" });
  assert.equal(purchases.listIntents(task.id).length, 1);
});

test("一笔多件及重复确认按实际件数计入，取消关闭或超时不回收数量与预算", (context) => {
  const { purchases, task, run } = storageFixture(context, { submissionMode: "automatic" });
  const request = reservation(task, run.id);
  purchases.reserve(request);
  const permit = purchases.beginSubmission(request.intentId, request.evidence);
  assert.equal(permit.mode, "automatic");
  const confirmation = {
    intentId: request.intentId,
    submissionId: permit.submissionId,
    orderNumber: "JD123456",
    evidence: request.evidence,
    paymentStatus: "unpaid" as const,
  };
  const order = purchases.confirm(confirmation);
  assert.equal(purchases.confirm(confirmation).id, order.id);
  assert.equal(purchases.progress(task.id).confirmedQuantity, 2);
  for (const status of ["cancelled", "closed", "expired"] as const) {
    purchases.updatePaymentStatus(request.intentId, status);
    assert.equal(purchases.progress(task.id).confirmedQuantity, 2);
    assert.equal(purchases.progress(task.id).heldCents, 81_000);
  }
  assert.equal(purchases.listOrders(task.id).length, 1);
  assert.throws(() => purchases.confirm({ ...confirmation, orderNumber: "JD999999" }), {
    code: "order_conflict",
  });
  assert.throws(
    () =>
      purchases.resolveNoOrder({
        intentId: request.intentId,
        checkedAt: new Date().toISOString(),
        reason: "订单取消",
      }),
    { code: "not_pending" },
  );
});

test("单价和任务总预算分别限制，其他平台未决金额同样占用共同预算", (context) => {
  const { purchases, task, run } = storageFixture(context, {
    orderQuantity: 1,
    budget: { currency: "CNY", maxUnitPriceCents: 50_000, totalBudgetCents: 70_000 },
  });
  const first = reservation(task, run.id);
  purchases.reserve(first);
  purchases.beginSubmission(first.intentId, first.evidence);
  assert.throws(() => purchases.reserve(reservation(task, run.id, 1)), { code: "budget_exceeded" });
  assert.equal(purchases.listIntents(task.id).length, 1);
});

test("错误商品、SKU、规格、数量、店铺、复杂订单和不明价格均拒绝预留", (context) => {
  const { purchases, task, run } = storageFixture(context);
  const scenarios = [
    { productId: "different" },
    { specifications: { 尺码: "43", 颜色: "黑色" } },
    { quantity: 1 },
    { seller: "其他店铺" },
    { unitPriceCents: null },
    { payableTotalCents: null },
    { shippingIncluded: false },
    { isCheckout: false },
    { unitPriceCents: 50_001, payableTotalCents: 101_002 },
    { itemCount: 2 },
    { payableTotalCents: 100 },
    { observedAt: "2020-01-01T00:00:00Z" },
  ];
  for (const evidence of scenarios)
    assert.throws(() =>
      purchases.reserve(
        reservation(task, run.id, 0, { evidence: checkoutEvidence(task, 0, evidence) }),
      ),
    );
  for (const orderKind of ["deposit", "installment", "trade_in", "bundle", "unsupported"] as const)
    assert.throws(
      () =>
        purchases.reserve(
          reservation(task, run.id, 0, { evidence: checkoutEvidence(task, 0, { orderKind }) }),
        ),
      { code: "manual_handoff" },
    );
  assert.equal(purchases.listIntents(task.id).length, 0);
  const definition = purchaseDefinition();
  definition.candidates[0].skuId = "sku-42";
  const skuTask = purchases.createTask(definition);
  const skuRun = purchases.startRun(skuTask.id);
  assert.throws(
    () =>
      purchases.reserve(
        reservation(skuTask, skuRun.id, 0, {
          evidence: checkoutEvidence(skuTask, 0, { skuId: "sku-43" }),
        }),
      ),
    { code: "product_mismatch" },
  );
});

test("提交前重新核对价格和提交关联，失败仍保留原预留", (context) => {
  const { purchases, task, run } = storageFixture(context);
  const request = reservation(task, run.id);
  purchases.reserve(request);
  assert.throws(
    () =>
      purchases.beginSubmission(request.intentId, {
        ...request.evidence,
        payableTotalCents: 82_000,
      }),
    { code: "price_changed" },
  );
  assert.equal(purchases.listIntents(task.id)[0].status, "reserved");
  const permit = purchases.beginSubmission(request.intentId, request.evidence);
  assert.throws(
    () =>
      purchases.confirm({
        intentId: request.intentId,
        submissionId: randomUUID(),
        orderNumber: "JD123456",
        evidence: request.evidence,
        paymentStatus: "unpaid",
      }),
    { code: "submission_mismatch" },
  );
  assert.throws(
    () =>
      purchases.confirm({
        intentId: request.intentId,
        submissionId: permit.submissionId,
        orderNumber: "JD123456",
        evidence: { ...request.evidence, quantity: 1 },
        paymentStatus: "unpaid",
      }),
    { code: "quantity_mismatch" },
  );
  assert.equal(purchases.progress(task.id).confirmedQuantity, 0);
});

test("停止与新运行只继承剩余额度，重启保留未决记录且不重复授权", (context) => {
  const { purchases, store, directory, task, run } = storageFixture(context, { orderQuantity: 1 });
  const first = reservation(task, run.id);
  purchases.reserve(first);
  const permit = purchases.beginSubmission(first.intentId, first.evidence);
  const unsubmitted = reservation(task, run.id, 1);
  purchases.reserve(unsubmitted);
  assert.throws(() => purchases.startRun(task.id), { code: "run_active" });
  store.close();
  const reopened = openDesktopStore(directory, resolve("migrations"));
  try {
    reopened.purchases.recoverInterruptedRuns();
    assert.equal(reopened.purchases.progress(task.id).heldQuantity, 1);
    assert.equal(
      reopened.purchases.listIntents(task.id).find((item) => item.id === unsubmitted.intentId)
        ?.status,
      "released",
    );
    assert.throws(() => reopened.purchases.beginSubmission(first.intentId, first.evidence), {
      code: "run_inactive",
    });
    const nextRun = reopened.purchases.startRun(task.id);
    assert.notEqual(nextRun.id, run.id);
    assert.equal(reopened.purchases.progress(task.id).remainingQuantity, 2);
    reopened.purchases.confirm({
      intentId: first.intentId,
      submissionId: permit.submissionId,
      orderNumber: "JD123456",
      evidence: checkoutEvidence(task),
      paymentStatus: "unpaid",
    });
    assert.equal(reopened.purchases.progress(task.id).confirmedQuantity, 1);
    const next = reservation(task, nextRun.id);
    reopened.purchases.reserve(next);
    reopened.purchases.stopRun(nextRun.id);
    assert.equal(reopened.purchases.progress(task.id).heldQuantity, 1);
  } finally {
    reopened.close();
  }
});

test("未生成订单经核对才释放占用，保留审计且原意图不能再次提交", (context) => {
  const { purchases, task, run, directory } = storageFixture(context);
  const request = reservation(task, run.id);
  purchases.reserve(request);
  purchases.beginSubmission(request.intentId, request.evidence);
  purchases.resolveNoOrder({
    intentId: request.intentId,
    checkedAt: new Date().toISOString(),
    reason: "已核对平台订单及提交结果，未生成订单",
  });
  assert.equal(purchases.progress(task.id).heldQuantity, 0);
  assert.throws(() => purchases.beginSubmission(request.intentId, request.evidence), {
    code: "already_submitted",
  });
  const database = new Database(resolve(directory, "cartpilot.sqlite"), { readonly: true });
  try {
    assert.ok(
      database.prepare("SELECT * FROM purchase_events WHERE type = 'no_order_verified'").get(),
    );
  } finally {
    database.close();
  }
});
