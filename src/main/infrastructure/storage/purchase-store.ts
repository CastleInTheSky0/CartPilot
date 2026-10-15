import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
  ReservePurchaseSchema,
  type PurchaseRun,
} from "../../../shared/contracts/purchase-order.ts";
import type { PurchaseStore } from "../../application/purchase-store.ts";
import { checkoutResourceKeys, validateCheckout } from "../../domain/checkout-validation.ts";
import { PurchaseError } from "../../domain/purchase-error.ts";
import { purchaseProgress, reservationQuantity } from "../../domain/purchase-progress.ts";
import { PurchaseRecords } from "./purchase-records.ts";
import { PurchaseSubmissions } from "./purchase-submissions.ts";
import { checkoutLocks, purchaseIntents, submissionAttempts } from "./schema.ts";

export function createPurchaseStore(
  database: Database.Database,
  db: BetterSQLite3Database,
  now = Date.now,
): PurchaseStore {
  const records = new PurchaseRecords(database, db, now);
  const submissions = new PurchaseSubmissions(records);
  const releaseReservation = (intentId: string): void => {
    const intent = records.getIntent(intentId);
    if (
      intent.status !== "reserved" ||
      db.select().from(submissionAttempts).where(eq(submissionAttempts.intentId, intent.id)).get()
    )
      throw new PurchaseError(
        "cannot_release",
        "已进入提交阶段的意图必须先核对结果，不能直接释放。",
      );
    records.saveIntent({ ...intent, status: "released", updatedAt: records.timestamp() });
    records.releaseLocks(intent.id);
    records.event(intent.taskId, intent.id, "reservation_released");
  };
  const endRun = (run: PurchaseRun, status: "stopped" | "interrupted"): void => {
    if (run.status !== "active") return;
    records.saveRun({ ...run, status, endedAt: records.timestamp() });
    for (const intent of records.listIntents(run.taskId))
      if (intent.runId === run.id && intent.status === "reserved") releaseReservation(intent.id);
    records.event(run.taskId, null, `run_${status}`, { runId: run.id });
  };

  return {
    createTask: (input) => records.atomic(() => records.createTask(input)),
    listTasks: () => records.listTasks(),
    getTask: (taskId) => records.getTask(taskId),
    startRun(taskId) {
      return records.atomic(() => {
        records.assertExecutionAllowed();
        const task = records.getTask(taskId);
        if (purchaseProgress(task.definition, records.listIntents(taskId)).isComplete)
          throw new PurchaseError("target_complete", "任务目标已完成；新一批购买请另建任务。");
        if (records.runs(taskId).some((run) => run.status === "active"))
          throw new PurchaseError("run_active", "该任务已有运行，不能重复启动。");
        const run: PurchaseRun = {
          id: randomUUID(),
          taskId,
          status: "active",
          createdAt: records.timestamp(),
          endedAt: null,
        };
        records.saveRun(run);
        records.event(taskId, null, "run_started", { runId: run.id });
        return run;
      });
    },
    stopRun: (runId) => records.atomic(() => endRun(records.getRun(runId), "stopped")),
    recoverInterruptedRuns() {
      records.atomic(() => {
        for (const run of records.runs()) endRun(run, "interrupted");
      });
    },
    reserve(input) {
      const request = ReservePurchaseSchema.parse(input);
      return records.atomic(() => {
        if (db.select().from(purchaseIntents).where(eq(purchaseIntents.id, request.intentId)).get())
          throw new PurchaseError("intent_exists", "购买意图已存在，不能重复预留。");
        const run = records.activeRun(request.runId);
        const task = records.getTask(run.taskId).definition;
        const candidate = task.candidates.find((item) => item.id === request.candidateId);
        if (!candidate) throw new PurchaseError("candidate_missing", "候选不属于当前任务。");
        records.assertExecutionAllowed(candidate.platform);
        const usage = records.listIntents(run.taskId);
        const quantity = reservationQuantity(
          task,
          candidate.platform,
          usage,
          request.availableQuantity,
        );
        validateCheckout(task, candidate, quantity, request.evidence, now());
        const amountCents = request.evidence.payableTotalCents;
        if (amountCents === null)
          throw new PurchaseError("unclear_price", "最终应付金额无法读取。");
        if (amountCents > purchaseProgress(task, usage).remainingBudgetCents)
          throw new PurchaseError("budget_exceeded", "已下单、未决与预留金额合计超过任务总预算。");
        const resourceKeys = checkoutResourceKeys(request.resources, candidate);
        if (
          resourceKeys.some((key) =>
            db.select().from(checkoutLocks).where(eq(checkoutLocks.key, key)).get(),
          )
        )
          throw new PurchaseError("resource_busy", "标签页或同账户结账资源已被占用，请等待。");
        const intent = {
          id: request.intentId,
          taskId: run.taskId,
          runId: run.id,
          candidateId: candidate.id,
          platform: candidate.platform,
          quantity,
          amountCents,
          status: "reserved" as const,
          evidence: request.evidence,
          resources: request.resources,
          createdAt: records.timestamp(),
          updatedAt: records.timestamp(),
        };
        records.saveIntent(intent);
        for (const key of resourceKeys)
          db.insert(checkoutLocks).values({ key, intentId: intent.id }).run();
        records.event(run.taskId, intent.id, "purchase_reserved", { quantity, amountCents });
        return intent;
      });
    },
    beginSubmission: (intentId, evidence) => submissions.begin(intentId, evidence),
    confirm: (input) => submissions.confirm(input),
    releaseReservation: (intentId) => records.atomic(() => releaseReservation(intentId)),
    resolveNoOrder: (input) => submissions.resolveNoOrder(input),
    updatePaymentStatus: (intentId, status) => submissions.updatePaymentStatus(intentId, status),
    listIntents: (taskId) => {
      records.getTask(taskId);
      return records.listIntents(taskId);
    },
    listOrders: (taskId) => {
      records.getTask(taskId);
      return records.listOrders(taskId);
    },
    progress: (taskId) =>
      purchaseProgress(records.getTask(taskId).definition, records.listIntents(taskId)),
  };
}
