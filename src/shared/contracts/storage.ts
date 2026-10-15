import { z } from "zod";

export const StorageStatusSchema = z.strictObject({
  databasePath: z.string(),
  schemaVersion: z.int().positive(),
  installationId: z.uuid(),
  sqliteVersion: z.string(),
});

export type StorageStatus = z.infer<typeof StorageStatusSchema>;
