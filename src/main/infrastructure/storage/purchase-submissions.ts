import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  CheckoutEvidenceSchema,
  ConfirmPurchaseSchema,
  NoOrderResolutionSchema,
  PaymentStatusSchema,
  PurchaseOrderSchema,
  SubmissionAttemptSchema,
  type CheckoutEvidence,
  type ConfirmPurchase,
  type NoOrderResolution,
  type PaymentStatus,
} from "../../../shared/contracts/purchase-order.ts";
import { validateCheckout } from "../../domain/checkout-validation.ts";
import { PurchaseError } from "../../domain/purchase-error.ts";
import { PurchaseRecords } from "./purchase-records.ts";
import { purchaseOrders, submissionAttempts } from "./schema.ts";

export class PurchaseSubmissions {
  constructor(private readonly records: PurchaseRecords) {}

  begin(intentId: string, input: CheckoutEvidence) {
    const evidence = CheckoutEvidenceSchema.parse(input);
    return this.records.atomic(() => {
      const intent = this.records.getIntent(intentId);
      this.records.activeRun(intent.runId);
      const prior = this.records.db
        .select()
        .from(submissionAttempts)
        .where(eq(submissionAttempts.intentId, intent.id))
        .get();
      if (intent.status !== "reserved" || prior)
        throw new PurchaseError("already_submitted", "本次意图已提交或已结束，不能重复授权。");
      const task = this.records.getTask(intent.taskId).definition;
      const candidate = task.candidates.find((item) => item.id === intent.candidateId);
      if (!candidate) throw new PurchaseError("candidate_missing", "候选不存在。");
      validateCheckout(task, candidate, intent.quantity, evidence, this.records.now());
      if (
        evidence.payableTotalCents !== intent.amountCents ||
        evidence.unitPriceCents !== intent.evidence.unitPriceCents
      )
        throw new PurchaseError("price_changed", "页面价格已变化，请重新准备并预留。");
      const attempt = SubmissionAttemptSchema.parse({
        id: randomUUID(),
        intentId: intent.id,
        mode: task.submissionMode,
        outcome: "unknown",
        createdAt: this.records.timestamp(),
      });
      this.records.db
        .insert(submissionAttempts)
        .values({ intentId: intent.id, record: JSON.stringify(attempt) })
        .run();
      this.records.saveIntent({
        ...intent,
        evidence,
        status: "pending",
        updatedAt: this.records.timestamp(),
      });
      this.records.event(intent.taskId, intent.id, "submission_authorized", {
        mode: task.submissionMode,
      });
      return { intentId: intent.id, submissionId: attempt.id, mode: task.submissionMode };
    });
  }

  confirm(input: ConfirmPurchase) {
    const confirmation = ConfirmPurchaseSchema.parse(input);
    return this.records.atomic(() => {
      const intent = this.records.getIntent(confirmation.intentId);
      const attemptRow = this.records.db
        .select()
        .from(submissionAttempts)
        .where(eq(submissionAttempts.intentId, intent.id))
        .get();
      if (!attemptRow) throw new PurchaseError("attempt_missing", "本次意图尚无持久化提交记录。");
      const attempt = SubmissionAttemptSchema.parse(JSON.parse(attemptRow.record));
      if (attempt.intentId !== intent.id || attempt.id !== confirmation.submissionId)
        throw new PurchaseError(
          "submission_mismatch",
          "订单证据未关联本次提交，继续保留待核对占用。",
        );
      const existing = this.records
        .listOrders(intent.taskId)
        .find((order) => order.intentId === intent.id);
      if (existing) {
        if (existing.orderNumber !== confirmation.orderNumber)
          throw new PurchaseError("order_conflict", "同一次意图不能关联不同订单。");
        return existing;
      }
      if (intent.status !== "pending")
        throw new PurchaseError("not_pending", "本次意图尚未提交或已经释放。");
      const task = this.records.getTask(intent.taskId).definition;
      const candidate = task.candidates.find((item) => item.id === intent.candidateId);
      if (!candidate) throw new PurchaseError("candidate_missing", "候选不存在。");
      validateCheckout(
        task,
        candidate,
        intent.quantity,
        confirmation.evidence,
        this.records.now(),
        false,
      );
      if (confirmation.evidence.payableTotalCents !== intent.amountCents)
        throw new PurchaseError(
          "order_amount_mismatch",
          "订单金额与本次提交意图不一致，继续保留待核对占用。",
        );
      const duplicate = this.records.db
        .select()
        .from(purchaseOrders)
        .where(
          and(
            eq(purchaseOrders.platform, intent.platform),
            eq(purchaseOrders.orderNumber, confirmation.orderNumber),
          ),
        )
        .get();
      if (duplicate)
        throw new PurchaseError("order_reused", "该平台订单号已关联其他购买意图，不能重复计数。");
      const order = PurchaseOrderSchema.parse({
        ...confirmation,
        id: randomUUID(),
        taskId: intent.taskId,
        platform: intent.platform,
        createdAt: this.records.timestamp(),
      });
      this.records.db
        .insert(purchaseOrders)
        .values({
          id: order.id,
          taskId: order.taskId,
          intentId: intent.id,
          platform: order.platform,
          orderNumber: order.orderNumber,
          record: JSON.stringify(order),
        })
        .run();
      this.records.saveIntent({
        ...intent,
        status: "confirmed",
        updatedAt: this.records.timestamp(),
      });
      this.updateAttempt(intent.id, "confirmed");
      this.records.releaseLocks(intent.id);
      this.records.event(intent.taskId, intent.id, "order_confirmed", {
        orderNumber: order.orderNumber,
        quantity: intent.quantity,
        amountCents: intent.amountCents,
      });
      return order;
    });
  }

  resolveNoOrder(input: NoOrderResolution): void {
    const resolution = NoOrderResolutionSchema.parse(input);
    this.records.atomic(() => {
      const intent = this.records.getIntent(resolution.intentId);
      if (intent.status !== "pending")
        throw new PurchaseError("not_pending", "只有未决提交可核对为未生成订单。");
      const age = this.records.now() - Date.parse(resolution.checkedAt);
      if (age < 0 || age > 30_000)
        throw new PurchaseError("stale_resolution", "请重新核对平台订单后记录处置。");
      this.records.saveIntent({
        ...intent,
        status: "released",
        updatedAt: this.records.timestamp(),
      });
      this.updateAttempt(intent.id, "no_order");
      this.records.releaseLocks(intent.id);
      this.records.event(intent.taskId, intent.id, "no_order_verified", resolution);
    });
  }

  updatePaymentStatus(intentId: string, input: PaymentStatus): void {
    const status = PaymentStatusSchema.parse(input);
    this.records.atomic(() => {
      const intent = this.records.getIntent(intentId);
      const order = this.records
        .listOrders(intent.taskId)
        .find((item) => item.intentId === intent.id);
      if (!order) throw new PurchaseError("order_missing", "订单尚未确认。");
      if (order.paymentStatus === status) return;
      const record = PurchaseOrderSchema.parse({ ...order, paymentStatus: status });
      this.records.db
        .update(purchaseOrders)
        .set({ record: JSON.stringify(record) })
        .where(eq(purchaseOrders.id, order.id))
        .run();
      this.records.event(intent.taskId, intent.id, "payment_status_changed", {
        before: order.paymentStatus,
        after: status,
      });
    });
  }

  private updateAttempt(intentId: string, outcome: "confirmed" | "no_order"): void {
    const row = this.records.db
      .select()
      .from(submissionAttempts)
      .where(eq(submissionAttempts.intentId, z.uuid().parse(intentId)))
      .get();
    if (!row) throw new PurchaseError("attempt_missing", "持久化提交记录缺失。");
    const attempt = SubmissionAttemptSchema.parse(JSON.parse(row.record));
    if (attempt.intentId !== intentId)
      throw new PurchaseError("corrupt_record", "提交记录身份不一致。");
    this.records.db
      .update(submissionAttempts)
      .set({ record: JSON.stringify({ ...attempt, outcome }) })
      .where(eq(submissionAttempts.intentId, intentId))
      .run();
  }
}
