import { z } from "zod";
import { PlatformSchema } from "./browser.ts";
import {
  MoneySchema,
  QuantitySchema,
  SpecificationsSchema,
  TimestampSchema,
} from "./purchase-task.ts";

export const CheckoutEvidenceSchema = z.strictObject({
  productId: z.string().trim().min(1).max(200),
  skuId: z.string().trim().min(1).max(200).nullable(),
  specifications: SpecificationsSchema,
  seller: z.string().trim().min(1).max(200).nullable(),
  quantity: QuantitySchema,
  itemCount: z.int().positive(),
  unitPriceCents: MoneySchema.nullable(),
  payableTotalCents: MoneySchema.nullable(),
  shippingIncluded: z.boolean(),
  isCheckout: z.boolean(),
  orderKind: z.enum([
    "full_payment",
    "reserved_full_payment",
    "deposit",
    "installment",
    "trade_in",
    "bundle",
    "unsupported",
  ]),
  observedAt: TimestampSchema,
});

export const PurchaseRunSchema = z.strictObject({
  id: z.uuid(),
  taskId: z.uuid(),
  status: z.enum(["active", "stopped", "interrupted"]),
  createdAt: TimestampSchema,
  endedAt: TimestampSchema.nullable(),
});

export const CheckoutResourcesSchema = z.strictObject({
  browserSessionId: z.uuid(),
  tabId: z.uuid(),
  profileId: z.string().trim().min(1).max(200),
});

export const ReservePurchaseSchema = z.strictObject({
  intentId: z.uuid(),
  runId: z.uuid(),
  candidateId: z.uuid(),
  availableQuantity: QuantitySchema,
  evidence: CheckoutEvidenceSchema,
  resources: CheckoutResourcesSchema,
});

export const PurchaseIntentSchema = z.strictObject({
  id: z.uuid(),
  taskId: z.uuid(),
  runId: z.uuid(),
  candidateId: z.uuid(),
  platform: PlatformSchema,
  quantity: QuantitySchema,
  amountCents: MoneySchema,
  status: z.enum(["reserved", "pending", "confirmed", "released"]),
  evidence: CheckoutEvidenceSchema,
  resources: CheckoutResourcesSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const PaymentStatusSchema = z.enum(["unpaid", "paid", "cancelled", "closed", "expired"]);
export const ConfirmPurchaseSchema = z.strictObject({
  intentId: z.uuid(),
  submissionId: z.uuid(),
  orderNumber: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,99}$/),
  evidence: CheckoutEvidenceSchema,
  paymentStatus: PaymentStatusSchema,
});
export const PurchaseOrderSchema = ConfirmPurchaseSchema.extend({
  id: z.uuid(),
  taskId: z.uuid(),
  platform: PlatformSchema,
  createdAt: TimestampSchema,
});
export const SubmissionAttemptSchema = z.strictObject({
  id: z.uuid(),
  intentId: z.uuid(),
  mode: z.enum(["automatic", "manual"]),
  outcome: z.enum(["unknown", "confirmed", "no_order"]),
  createdAt: TimestampSchema,
});
export const NoOrderResolutionSchema = z.strictObject({
  intentId: z.uuid(),
  reason: z.string().trim().min(1).max(1000),
  checkedAt: TimestampSchema,
});

export type CheckoutEvidence = z.infer<typeof CheckoutEvidenceSchema>;
export type PurchaseRun = z.infer<typeof PurchaseRunSchema>;
export type CheckoutResources = z.infer<typeof CheckoutResourcesSchema>;
export type ReservePurchase = z.infer<typeof ReservePurchaseSchema>;
export type PurchaseIntent = z.infer<typeof PurchaseIntentSchema>;
export type ConfirmPurchase = z.infer<typeof ConfirmPurchaseSchema>;
export type PurchaseOrder = z.infer<typeof PurchaseOrderSchema>;
export type SubmissionAttempt = z.infer<typeof SubmissionAttemptSchema>;
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;
export type NoOrderResolution = z.infer<typeof NoOrderResolutionSchema>;
