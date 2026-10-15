import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { z } from "zod";
import {
  ConnectBrowserSchema,
  type ConnectBrowserInput,
} from "../../../shared/contracts/browser.ts";
import { StorageStatusSchema, type StorageStatus } from "../../../shared/contracts/storage.ts";
import { desktopSettings } from "./schema.ts";
import type { PurchaseStore } from "../../application/purchase-store.ts";
import { createPurchaseStore } from "./purchase-store.ts";
import type { LegacyDataStore } from "../../application/legacy-data-store.ts";
import { createLegacyDataStore } from "./legacy-data-store.ts";
import { PurchaseRecords } from "./purchase-records.ts";

export interface DesktopStore {
  purchases: PurchaseStore;
  legacy: LegacyDataStore;
  status(): StorageStatus;
  readBrowserPreferences(): ConnectBrowserInput;
  saveBrowserPreferences(input: ConnectBrowserInput): void;
  close(): void;
}

export function openDesktopStore(dataDirectory: string, migrationsDirectory: string): DesktopStore {
  mkdirSync(dataDirectory, { recursive: true });
  const databasePath = join(dataDirectory, "cartpilot.sqlite");
  const database = new Database(databasePath);
  try {
    database.pragma("journal_mode = WAL");
    database.pragma("synchronous = FULL");
    database.pragma("foreign_keys = ON");
    database.pragma("busy_timeout = 5000");
    z.literal("ok").parse(database.pragma("quick_check", { simple: true }));
    const db = drizzle(database);
    migrate(db, { migrationsFolder: migrationsDirectory });

    const read = (key: string): string | undefined =>
      db.select().from(desktopSettings).where(eq(desktopSettings.key, key)).get()?.value;
    const write = (key: string, value: string): void => {
      db.insert(desktopSettings)
        .values({ key, value })
        .onConflictDoUpdate({ target: desktopSettings.key, set: { value } })
        .run();
    };
    const readBrowserPreferences = (): ConnectBrowserInput => {
      const saved = read("browser-preferences");
      const value: unknown = saved ? JSON.parse(saved) : { profileDirectory: null };
      return ConnectBrowserSchema.parse(value);
    };
    readBrowserPreferences();
    const installationId = database.transaction(() => {
      const saved = read("installation-id");
      if (saved) return z.uuid().parse(saved);
      const id = randomUUID();
      write("installation-id", id);
      return id;
    })();
    const migration = z
      .object({ count: z.int().positive() })
      .parse(database.prepare("SELECT count(*) AS count FROM __drizzle_migrations").get());
    const sqlite = z
      .object({ version: z.string() })
      .parse(database.prepare("SELECT sqlite_version() AS version").get());
    const status = StorageStatusSchema.parse({
      databasePath,
      schemaVersion: migration.count,
      installationId,
      sqliteVersion: sqlite.version,
    });

    return {
      purchases: createPurchaseStore(database, db),
      legacy: createLegacyDataStore(new PurchaseRecords(database, db, Date.now), dataDirectory),
      status(): StorageStatus {
        return { ...status };
      },
      readBrowserPreferences,
      saveBrowserPreferences(input: ConnectBrowserInput): void {
        write("browser-preferences", JSON.stringify(ConnectBrowserSchema.parse(input)));
      },
      close(): void {
        if (database.open) database.close();
      },
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
