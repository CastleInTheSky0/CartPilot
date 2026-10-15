import { z } from "zod";
import { ChromeProfileSchema, PlatformSchema } from "./browser.ts";
import { TimestampSchema } from "./purchase-task.ts";

export const AccessFamilySchema = z.enum(["apple", "taobao", "jd", "douyin"]);
export const AccessRestrictionSchema = z.strictObject({
  family: AccessFamilySchema,
  until: TimestampSchema,
  status: z.union([z.literal(403), z.literal(429), z.literal(541)]),
  message: z.string().max(2000),
});
export const LegacyImportSchema = z.strictObject({
  sourceId: z.string().regex(/^[a-f0-9]{64}$/),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  sourceDirectory: z.string(),
  backupDirectory: z.string(),
  importedAt: TimestampSchema,
  taskId: z.uuid().nullable(),
  issues: z.array(z.string()),
});
export const LegacyImportRequestSchema = z.strictObject({
  sourceDirectory: z.string().min(1),
  sourceStopped: z.literal(true),
});

// 仅用于读取迁移前格式；原始内容另行备份，不恢复执行授权。
export const LegacySettingsSchema = z.object({
  platform: PlatformSchema.default("apple"),
  productUrl: z.string().max(4000),
  backupProductUrl: z.string().max(4000).default(""),
  expectedSeller: z.string().max(200).default(""),
  color: z.string().min(1).max(100),
  capacity: z.string().min(1).max(100),
  quantity: z.literal(1),
  maxTotal: z
    .number()
    .positive()
    .max(100_000)
    .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001),
  autoSubmit: z.boolean(),
  launchAt: TimestampSchema,
  maxMinutes: z.int().min(1).max(120),
});
export const LegacyWorkspaceSchema = z
  .object({
    version: z.literal(2),
    activePlatform: PlatformSchema,
    mode: z.enum(["single", "race"]),
    enabledPlatforms: z
      .array(PlatformSchema)
      .min(1)
      .max(5)
      .refine((values) => new Set(values).size === values.length),
    plans: z.record(PlatformSchema, LegacySettingsSchema),
  })
  .superRefine((workspace, context) => {
    for (const [platform, plan] of Object.entries(workspace.plans))
      if (platform !== plan.platform)
        context.addIssue({
          code: "custom",
          path: ["plans", platform],
          message: "旧平台与配置不一致",
        });
  });
export const LegacyAccessStateSchema = z.object({
  version: z.literal(1),
  restrictions: z.partialRecord(AccessFamilySchema, AccessRestrictionSchema.omit({ family: true })),
});
export const LegacySubmissionSchema = z.object({
  platform: PlatformSchema.optional(),
  productUrl: z.string().optional(),
  runId: z.string().min(1),
  at: TimestampSchema,
  fingerprint: z.string(),
  result: z.enum(["unknown", "confirmed"]),
  resolved: z.boolean().optional(),
});

export const LegacyConnectionSchema = z.object({
  version: z.literal(1),
  mode: z.enum(["extension", "managed"]),
  profileDirectory: ChromeProfileSchema,
});

export type LegacyImport = z.infer<typeof LegacyImportSchema>;
export type LegacyImportRequest = z.infer<typeof LegacyImportRequestSchema>;
export type AccessRestriction = z.infer<typeof AccessRestrictionSchema>;
