import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const desktopSettings = sqliteTable("desktop_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const purchaseTasks = sqliteTable("purchase_tasks", {
  id: text("id").primaryKey(),
  record: text("record").notNull(),
});

export const purchaseRuns = sqliteTable("purchase_runs", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => purchaseTasks.id),
  record: text("record").notNull(),
});

export const purchaseIntents = sqliteTable("purchase_intents", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => purchaseTasks.id),
  runId: text("run_id")
    .notNull()
    .references(() => purchaseRuns.id),
  record: text("record").notNull(),
});

export const submissionAttempts = sqliteTable("submission_attempts", {
  intentId: text("intent_id")
    .primaryKey()
    .references(() => purchaseIntents.id),
  record: text("record").notNull(),
});

export const purchaseOrders = sqliteTable(
  "purchase_orders",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => purchaseTasks.id),
    intentId: text("intent_id")
      .notNull()
      .references(() => purchaseIntents.id),
    platform: text("platform").notNull(),
    orderNumber: text("order_number").notNull(),
    record: text("record").notNull(),
  },
  (table) => [
    uniqueIndex("purchase_orders_intent_unique").on(table.intentId),
    uniqueIndex("purchase_orders_platform_number_unique").on(table.platform, table.orderNumber),
  ],
);

export const checkoutLocks = sqliteTable("checkout_locks", {
  key: text("key").primaryKey(),
  intentId: text("intent_id")
    .notNull()
    .references(() => purchaseIntents.id),
});

export const purchaseEvents = sqliteTable("purchase_events", {
  sequence: integer("sequence").primaryKey({ autoIncrement: true }),
  taskId: text("task_id")
    .notNull()
    .references(() => purchaseTasks.id),
  intentId: text("intent_id").references(() => purchaseIntents.id),
  type: text("type").notNull(),
  detail: text("detail").notNull(),
  at: text("at").notNull(),
});

export const legacyImports = sqliteTable("legacy_imports", {
  sourceId: text("source_id").primaryKey(),
  record: text("record").notNull(),
});

export const accessRestrictions = sqliteTable("access_restrictions", {
  family: text("family").primaryKey(),
  record: text("record").notNull(),
});
