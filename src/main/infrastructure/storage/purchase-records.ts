import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { z } from "zod";
import {
  PurchaseIntentSchema,
  PurchaseOrderSchema,
  PurchaseRunSchema,
  type PurchaseIntent,
  type PurchaseRun,
} from "../../../shared/contracts/purchase-order.ts";
import {
  PurchaseTaskDefinitionSchema,
  PurchaseTaskSchema,
  type PurchaseTaskDefinition,
} from "../../../shared/contracts/purchase-task.ts";
import { PurchaseError } from "../../domain/purchase-error.ts";
import {
  checkoutLocks,
  purchaseEvents,
  purchaseIntents,
  purchaseOrders,
  purchaseRuns,
  purchaseTasks,
} from "./schema.ts";

export class PurchaseRecords {
  constructor(
    readonly database: Database.Database,
    readonly db: BetterSQLite3Database,
    readonly now: () => number,
  ) {}

  atomic<T>(work: () => T): T {
    return this.database.transaction(work).immediate();
  }

  timestamp(): string {
    return new Date(this.now()).toISOString();
  }

  createTask(input: PurchaseTaskDefinition) {
    const task = PurchaseTaskSchema.parse({
      id: randomUUID(),
      definition: PurchaseTaskDefinitionSchema.parse(input),
      createdAt: this.timestamp(),
    });
    this.db
      .insert(purchaseTasks)
      .values({ id: task.id, record: JSON.stringify(task) })
      .run();
    this.event(task.id, null, "task_created");
    return task;
  }

  getTask(taskId: string) {
    const row = this.db
      .select()
      .from(purchaseTasks)
      .where(eq(purchaseTasks.id, z.uuid().parse(taskId)))
      .get();
    if (!row) throw new PurchaseError("task_missing", "购买任务不存在。");
    const task = PurchaseTaskSchema.parse(JSON.parse(row.record));
    if (task.id !== row.id) throw new PurchaseError("corrupt_record", "任务记录身份不一致。");
    return task;
  }

  listTasks() {
    return this.db
      .select()
      .from(purchaseTasks)
      .all()
      .map((row) => this.getTask(row.id));
  }

  getRun(runId: string): PurchaseRun {
    const row = this.db
      .select()
      .from(purchaseRuns)
      .where(eq(purchaseRuns.id, z.uuid().parse(runId)))
      .get();
    if (!row) throw new PurchaseError("run_missing", "任务运行记录不存在。");
    const run = PurchaseRunSchema.parse(JSON.parse(row.record));
    if (run.id !== row.id || run.taskId !== row.taskId)
      throw new PurchaseError("corrupt_record", "运行记录身份不一致。");
    return run;
  }

  activeRun(runId: string): PurchaseRun {
    const run = this.getRun(runId);
    if (run.status !== "active")
      throw new PurchaseError("run_inactive", "任务已停止，不能新增购买动作。");
    return run;
  }

  runs(taskId?: string): PurchaseRun[] {
    const rows = taskId
      ? this.db.select().from(purchaseRuns).where(eq(purchaseRuns.taskId, taskId)).all()
      : this.db.select().from(purchaseRuns).all();
    return rows.map((row) => this.getRun(row.id));
  }

  saveRun(run: PurchaseRun): void {
    const parsed = PurchaseRunSchema.parse(run);
    this.db
      .insert(purchaseRuns)
      .values({ id: parsed.id, taskId: parsed.taskId, record: JSON.stringify(parsed) })
      .onConflictDoUpdate({ target: purchaseRuns.id, set: { record: JSON.stringify(parsed) } })
      .run();
  }

  getIntent(intentId: string): PurchaseIntent {
    const row = this.db
      .select()
      .from(purchaseIntents)
      .where(eq(purchaseIntents.id, z.uuid().parse(intentId)))
      .get();
    if (!row) throw new PurchaseError("intent_missing", "购买意图不存在。");
    const intent = PurchaseIntentSchema.parse(JSON.parse(row.record));
    if (intent.id !== row.id || intent.taskId !== row.taskId || intent.runId !== row.runId)
      throw new PurchaseError("corrupt_record", "购买意图身份不一致。");
    return intent;
  }

  listIntents(taskId: string): PurchaseIntent[] {
    return this.db
      .select()
      .from(purchaseIntents)
      .where(eq(purchaseIntents.taskId, taskId))
      .all()
      .map((row) => this.getIntent(row.id));
  }

  saveIntent(intent: PurchaseIntent): void {
    const parsed = PurchaseIntentSchema.parse(intent);
    this.db
      .insert(purchaseIntents)
      .values({
        id: parsed.id,
        taskId: parsed.taskId,
        runId: parsed.runId,
        record: JSON.stringify(parsed),
      })
      .onConflictDoUpdate({ target: purchaseIntents.id, set: { record: JSON.stringify(parsed) } })
      .run();
  }

  listOrders(taskId: string) {
    return this.db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.taskId, taskId))
      .all()
      .map((row) => {
        const order = PurchaseOrderSchema.parse(JSON.parse(row.record));
        if (
          order.id !== row.id ||
          order.intentId !== row.intentId ||
          order.taskId !== row.taskId ||
          order.platform !== row.platform ||
          order.orderNumber !== row.orderNumber
        )
          throw new PurchaseError("corrupt_record", "订单记录身份不一致。");
        return order;
      });
  }

  releaseLocks(intentId: string): void {
    this.db.delete(checkoutLocks).where(eq(checkoutLocks.intentId, intentId)).run();
  }

  event(taskId: string, intentId: string | null, type: string, detail: unknown = {}): void {
    this.db
      .insert(purchaseEvents)
      .values({ taskId, intentId, type, detail: JSON.stringify(detail), at: this.timestamp() })
      .run();
  }
}
