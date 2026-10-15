import type { PurchaseStore } from "../../src/main/application/purchase-store.ts";
import { purchaseDefinition } from "../unit/purchase-fixture.ts";
import { checkoutEvidence, reservation } from "./purchase-storage-fixture.ts";

export function createHistoryScenario(purchases: PurchaseStore) {
  const task = purchases.createTask(
    purchaseDefinition({
      name: "历史核对示例",
      quantityPlan: { mode: "total", targetQuantity: 8 },
      budget: { currency: "CNY", maxUnitPriceCents: 50_000, totalBudgetCents: 400_000 },
    }),
  );
  const firstRun = purchases.startRun(task.id);
  for (const [orderNumber, paymentStatus] of [
    ["history-unpaid", "unpaid"],
    ["history-cancelled", "cancelled"],
  ]) {
    const intent = purchases.reserve(reservation(task, firstRun.id));
    const submission = purchases.beginSubmission(intent.id, checkoutEvidence(task));
    purchases.confirm({
      intentId: intent.id,
      submissionId: submission.submissionId,
      orderNumber,
      evidence: checkoutEvidence(task),
      paymentStatus: "unpaid",
    });
    if (paymentStatus === "cancelled") purchases.updatePaymentStatus(intent.id, "cancelled");
  }
  const pending = purchases.reserve(reservation(task, firstRun.id, 1));
  purchases.beginSubmission(pending.id, checkoutEvidence(task, 1));
  purchases.stopRun(firstRun.id);
  const checkedRun = purchases.startRun(task.id);
  const resolved = purchases.reserve(reservation(task, checkedRun.id));
  purchases.beginSubmission(resolved.id, checkoutEvidence(task));
  purchases.resolveNoOrder({
    intentId: resolved.id,
    checkedAt: new Date().toISOString(),
    reason: "已在隔离订单页核对，未生成订单",
  });
  purchases.stopRun(checkedRun.id);
  for (let index = 0; index < 26; index++) {
    const run = purchases.startRun(task.id);
    purchases.stopRun(run.id);
  }
  const interrupted = purchases.startRun(task.id);
  const reservationToRelease = purchases.reserve(reservation(task, interrupted.id));
  const untouched = purchases.createTask(purchaseDefinition({ name: "未运行任务" }));
  return { task, pending, resolved, interrupted, reservationToRelease, untouched };
}
