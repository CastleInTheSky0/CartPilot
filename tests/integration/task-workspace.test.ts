import assert from "node:assert/strict";
import test from "node:test";
import { TaskWorkspace } from "../../src/main/application/task-workspace.ts";
import { checkoutEvidence, reservation, storageFixture } from "./purchase-storage-fixture.ts";

test("工作台读取已确认、未决与预留的真实进度，订单取消后不回收预算", (context) => {
  const { purchases, task, run } = storageFixture(context, {
    quantityPlan: { mode: "total", targetQuantity: 8 },
    budget: { currency: "CNY", maxUnitPriceCents: 50_000, totalBudgetCents: 400_000 },
  });
  const first = purchases.reserve(reservation(task, run.id));
  const submission = purchases.beginSubmission(first.id, checkoutEvidence(task));
  purchases.confirm({
    intentId: first.id,
    submissionId: submission.submissionId,
    orderNumber: "workspace-order-1",
    evidence: checkoutEvidence(task),
    paymentStatus: "unpaid",
  });
  purchases.updatePaymentStatus(first.id, "cancelled");
  const pending = purchases.reserve(reservation(task, run.id, 1));
  purchases.beginSubmission(pending.id, checkoutEvidence(task, 1));
  purchases.reserve(reservation(task, run.id));
  const workspace = new TaskWorkspace(purchases);
  const overview = workspace.get(task.id);
  assert.equal(overview.progress.confirmedQuantity, 2);
  assert.equal(overview.progress.heldQuantity, 6);
  assert.equal(overview.progress.spentCents, 81_000);
  assert.equal(overview.progress.heldCents, 243_000);
  assert.equal(overview.progress.remainingBudgetCents, 157_000);
  assert.equal(
    overview.progress.byPlatform.find((item) => item.platform === "tmall")?.pendingQuantity,
    2,
  );
  assert.equal(
    overview.progress.byPlatform.find((item) => item.platform === "jd")?.reservedQuantity,
    2,
  );
  assert.deepEqual(workspace.list(), [overview]);
  assert.throws(() => workspace.get("invalid-id"));
});
