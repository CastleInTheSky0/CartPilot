import type {
  CheckoutEvidence,
  ConfirmPurchase,
  NoOrderResolution,
  PaymentStatus,
  PurchaseIntent,
  PurchaseOrder,
  PurchaseRun,
  ReservePurchase,
} from "../../shared/contracts/purchase-order.ts";
import type { PurchaseTask, PurchaseTaskDefinition } from "../../shared/contracts/purchase-task.ts";
import type { purchaseProgress } from "../domain/purchase-progress.ts";

export interface PurchaseStore {
  createTask(input: PurchaseTaskDefinition): PurchaseTask;
  listTasks(): PurchaseTask[];
  getTask(taskId: string): PurchaseTask;
  startRun(taskId: string): PurchaseRun;
  stopRun(runId: string): void;
  recoverInterruptedRuns(): void;
  reserve(input: ReservePurchase): PurchaseIntent;
  beginSubmission(
    intentId: string,
    evidence: CheckoutEvidence,
  ): { intentId: string; submissionId: string; mode: "automatic" | "manual" };
  confirm(input: ConfirmPurchase): PurchaseOrder;
  releaseReservation(intentId: string): void;
  resolveNoOrder(input: NoOrderResolution): void;
  updatePaymentStatus(intentId: string, status: PaymentStatus): void;
  listIntents(taskId: string): PurchaseIntent[];
  listOrders(taskId: string): PurchaseOrder[];
  progress(taskId: string): ReturnType<typeof purchaseProgress>;
}
