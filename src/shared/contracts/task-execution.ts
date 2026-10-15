import { z } from "zod";
import { TimestampSchema } from "./purchase-task.ts";

export const PreparedTaskSchema = z.strictObject({
  taskId: z.uuid(),
  preparedAt: TimestampSchema,
  validUntil: TimestampSchema,
  candidateIds: z
    .array(z.uuid())
    .min(1)
    .max(50)
    .refine((ids) => new Set(ids).size === ids.length),
});
export const ExecutionOutcomeSchema = z.strictObject({
  kind: z.enum(["paused", "cooldown", "exhausted"]),
  reason: z.string().trim().min(1).max(1000),
});
export const TaskPhaseSchema = z.enum([
  "review_required",
  "preparing",
  "ready",
  "scheduled",
  "running",
  "awaiting_user",
  "cooldown",
  "stopped",
  "completed",
  "error",
]);

export type PreparedTask = z.infer<typeof PreparedTaskSchema>;
export type ExecutionOutcome = z.infer<typeof ExecutionOutcomeSchema>;
export type TaskPhase = z.infer<typeof TaskPhaseSchema>;
