import type { Platform } from "../../shared/contracts/browser.ts";
import type {
  AccessRestriction,
  LegacyImport,
  LegacyImportRequest,
} from "../../shared/contracts/legacy-import.ts";

export interface LegacyDataStore {
  importDirectory(input: LegacyImportRequest): Promise<LegacyImport>;
  listImports(): LegacyImport[];
  readRestrictions(): AccessRestriction[];
  acknowledgeRestriction(taskId: string, platform: Platform, reason: string): void;
}
