import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const desktopSettings = sqliteTable("desktop_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
