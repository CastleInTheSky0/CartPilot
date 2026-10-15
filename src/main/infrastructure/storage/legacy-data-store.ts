import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  AccessFamilySchema,
  AccessRestrictionSchema,
  LegacyImportRequestSchema,
  LegacyImportSchema,
} from "../../../shared/contracts/legacy-import.ts";
import type { LegacyDataStore } from "../../application/legacy-data-store.ts";
import { PurchaseError } from "../../domain/purchase-error.ts";
import { convertLegacySnapshot } from "./legacy-conversion.ts";
import { backupLegacySnapshot, readLegacySnapshot } from "./legacy-snapshot.ts";
import { PurchaseRecords } from "./purchase-records.ts";
import { accessRestrictions, desktopSettings, legacyImports } from "./schema.ts";

export function createLegacyDataStore(
  records: PurchaseRecords,
  dataDirectory: string,
): LegacyDataStore {
  const listImports = () =>
    records.db
      .select()
      .from(legacyImports)
      .all()
      .map((row) => {
        const record = LegacyImportSchema.parse(JSON.parse(row.record));
        if (record.sourceId !== row.sourceId)
          throw new PurchaseError("corrupt_record", "旧数据导入记录身份不一致。");
        return record;
      });
  const readRestrictions = () =>
    records.db
      .select()
      .from(accessRestrictions)
      .all()
      .map((row) => {
        const record = AccessRestrictionSchema.parse(JSON.parse(row.record));
        if (record.family !== row.family)
          throw new PurchaseError("corrupt_record", "访问冷却记录身份不一致。");
        return record;
      });
  const assertStopped = () => {
    if (records.runs().some((run) => run.status === "active"))
      throw new PurchaseError("migration_requires_stop", "请先停止全部桌面任务，再迁移旧数据。");
  };
  return {
    listImports,
    readRestrictions,
    async importDirectory(input) {
      const request = LegacyImportRequestSchema.parse(input);
      assertStopped();
      const snapshot = await readLegacySnapshot(request.sourceDirectory);
      const prior = listImports().find((record) => record.sourceId === snapshot.sourceId);
      if (prior) {
        if (prior.fingerprint !== snapshot.fingerprint)
          throw new PurchaseError(
            "legacy_source_changed",
            "该来源已经导入且内容发生变化，请核对已有迁移记录，不重复创建目标。",
          );
        return prior;
      }
      const backupDirectory = await backupLegacySnapshot(snapshot, dataDirectory, records.database);
      const converted = convertLegacySnapshot(snapshot);
      return records.atomic(() => {
        assertStopped();
        const imported = listImports().find((record) => record.sourceId === snapshot.sourceId);
        if (imported) {
          if (imported.fingerprint !== snapshot.fingerprint)
            throw new PurchaseError(
              "legacy_source_changed",
              "该来源的导入快照已变化，请核对已有迁移记录。",
            );
          return imported;
        }
        const task = converted.definition ? records.createTask(converted.definition) : null;
        if (converted.browserPreferences)
          records.db
            .insert(desktopSettings)
            .values({
              key: "browser-preferences",
              value: JSON.stringify(converted.browserPreferences),
            })
            .onConflictDoNothing()
            .run();
        for (const restriction of converted.restrictions) {
          const existing = readRestrictions().find((item) => item.family === restriction.family);
          if (existing && Date.parse(existing.until) >= Date.parse(restriction.until)) continue;
          records.db
            .insert(accessRestrictions)
            .values({ family: restriction.family, record: JSON.stringify(restriction) })
            .onConflictDoUpdate({
              target: accessRestrictions.family,
              set: { record: JSON.stringify(restriction) },
            })
            .run();
        }
        const record = LegacyImportSchema.parse({
          sourceId: snapshot.sourceId,
          fingerprint: snapshot.fingerprint,
          sourceDirectory: snapshot.sourceDirectory,
          backupDirectory,
          importedAt: records.timestamp(),
          taskId: task?.id ?? null,
          issues: converted.issues,
        });
        records.db
          .insert(legacyImports)
          .values({ sourceId: record.sourceId, record: JSON.stringify(record) })
          .run();
        if (task)
          records.event(task.id, null, "legacy_imported", {
            sourceId: record.sourceId,
            issues: record.issues,
          });
        return record;
      });
    },
    acknowledgeRestriction(taskId, platform, input): void {
      records.atomic(() => {
        records.getTask(taskId);
        const reason = z.string().trim().min(1).max(1000).parse(input);
        const family = AccessFamilySchema.parse(platform === "tmall" ? "taobao" : platform);
        const restriction = readRestrictions().find((item) => item.family === family);
        if (!restriction) return;
        if (Date.parse(restriction.until) > records.now())
          throw new PurchaseError("cooldown_active", "访问冷却尚未结束，请等待后检查真实页面。");
        records.event(taskId, null, "restriction_reviewed", { restriction, reason });
        records.db.delete(accessRestrictions).where(eq(accessRestrictions.family, family)).run();
      });
    },
  };
}
