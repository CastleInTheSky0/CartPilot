import { z } from "zod";
import { PaymentStatusSchema, PurchaseIntentSchema, PurchaseRunSchema } from "./purchase-order.ts";
import { PlatformSchema } from "./browser.ts";
import { MoneySchema, QuantitySchema, TimestampSchema } from "./purchase-task.ts";

export const TaskHistoryQuerySchema = z.strictObject({
  taskId: z.uuid(),
  beforeSequence: z.int().positive().optional(),
});

export const TaskHistorySchema = z.strictObject({
  taskId: z.uuid(),
  runs: z.array(PurchaseRunSchema),
  intents: z.array(PurchaseIntentSchema.omit({ evidence: true, resources: true, taskId: true })),
  orders: z.array(
    z.strictObject({
      id: z.uuid(),
      intentId: z.uuid(),
      platform: PlatformSchema,
      orderNumber: z.string().min(1).max(100),
      quantity: QuantitySchema,
      amountCents: MoneySchema,
      paymentStatus: PaymentStatusSchema,
      createdAt: TimestampSchema,
    }),
  ),
  events: z
    .array(
      z.strictObject({
        sequence: z.int().positive(),
        intentId: z.uuid().nullable(),
        type: z.string().min(1).max(200),
        at: TimestampSchema,
        reason: z.string().max(1000).nullable(),
      }),
    )
    .max(50),
  nextBeforeSequence: z.int().positive().nullable(),
});

export type TaskHistoryQuery = z.infer<typeof TaskHistoryQuerySchema>;
export type TaskHistory = z.infer<typeof TaskHistorySchema>;
