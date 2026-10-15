import { z } from "zod";
import { PlatformSchema } from "./browser.ts";
import { MoneySchema, PurchaseTaskSchema } from "./purchase-task.ts";

const CountSchema = z.int().nonnegative();

export const PurchaseProgressSchema = z.strictObject({
  targetQuantity: CountSchema,
  confirmedQuantity: CountSchema,
  heldQuantity: CountSchema,
  spentCents: MoneySchema,
  heldCents: MoneySchema,
  remainingQuantity: CountSchema,
  remainingBudgetCents: MoneySchema,
  isComplete: z.boolean(),
  byPlatform: z
    .array(
      z.strictObject({
        platform: PlatformSchema,
        targetQuantity: CountSchema.nullable(),
        confirmedQuantity: CountSchema,
        pendingQuantity: CountSchema,
        reservedQuantity: CountSchema,
        remainingQuantity: CountSchema.nullable(),
      }),
    )
    .max(5),
});

export const TaskOverviewSchema = z.strictObject({
  task: PurchaseTaskSchema,
  progress: PurchaseProgressSchema,
});

export type PurchaseProgress = z.infer<typeof PurchaseProgressSchema>;
export type TaskOverview = z.infer<typeof TaskOverviewSchema>;
