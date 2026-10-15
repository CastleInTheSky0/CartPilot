import { z } from "zod";
import { PlatformSchema } from "./browser.ts";
import { canonicalCandidateUrl } from "./product-url.ts";

export const QuantitySchema = z.int().positive().max(1_000_000);
export const MoneySchema = z.int().nonnegative();
export const TimestampSchema = z.iso.datetime({ offset: true });
const LabelSchema = z.string().trim().min(1).max(200);

export const SpecificationsSchema = z
  .record(z.string().trim().min(1).max(60), LabelSchema)
  .refine((value) => Object.keys(value).length <= 30, "规格不能超过 30 项")
  .refine((value) => {
    const keys = Object.keys(value).map((key) =>
      key
        .normalize("NFKC")
        .replace(/[\s\u200b]/g, "")
        .toLowerCase(),
    );
    return new Set(keys).size === keys.length;
  }, "规格名称不能重复");

export const CandidateSchema = z
  .strictObject({
    id: z.uuid(),
    platform: PlatformSchema,
    productUrl: z
      .url()
      .max(4000)
      .refine((value) => {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password && !url.port;
      }, "商品链接必须使用无凭证的 HTTPS 地址"),
    productId: LabelSchema.nullable(),
    skuId: LabelSchema.nullable(),
    expectedSeller: LabelSchema.nullable(),
    launchAt: TimestampSchema.optional(),
  })
  .superRefine((candidate, context) => {
    if (!canonicalCandidateUrl(candidate.productUrl, candidate.platform))
      context.addIssue({
        code: "custom",
        path: ["productUrl"],
        message: "请使用当前平台的完整商品详情链接",
      });
  })
  .transform((candidate) => ({
    ...candidate,
    productUrl:
      canonicalCandidateUrl(candidate.productUrl, candidate.platform) ?? candidate.productUrl,
  }));

export const QuantityPlanSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("total"), targetQuantity: QuantitySchema }),
  z.strictObject({
    mode: z.literal("per_platform"),
    targets: z
      .array(z.strictObject({ platform: PlatformSchema, quantity: QuantitySchema }))
      .min(1)
      .max(5)
      .refine(
        (targets) => new Set(targets.map((item) => item.platform)).size === targets.length,
        "每个平台只能设置一份数量目标",
      ),
  }),
]);

export const PurchaseTaskDefinitionSchema = z
  .strictObject({
    version: z.literal(1),
    name: LabelSchema,
    product: z.strictObject({ name: LabelSchema, specifications: SpecificationsSchema }),
    candidates: z.array(CandidateSchema).min(1).max(50),
    quantityPlan: QuantityPlanSchema,
    orderQuantity: QuantitySchema,
    allowPartial: z.boolean().default(false),
    budget: z.strictObject({
      currency: z.literal("CNY"),
      maxUnitPriceCents: MoneySchema.positive(),
      totalBudgetCents: MoneySchema.positive(),
    }),
    submissionMode: z.enum(["automatic", "manual"]),
    schedule: z.strictObject({ launchAt: TimestampSchema, maxRunMinutes: z.int().min(1).max(120) }),
  })
  .superRefine((task, context) => {
    if (new Set(task.candidates.map((candidate) => candidate.id)).size !== task.candidates.length)
      context.addIssue({ code: "custom", path: ["candidates"], message: "候选 ID 不能重复" });
    const platforms = new Set(task.candidates.map((candidate) => candidate.platform));
    if (task.quantityPlan.mode === "per_platform") {
      const targets = new Set(task.quantityPlan.targets.map((target) => target.platform));
      if (
        platforms.size !== targets.size ||
        [...platforms].some((platform) => !targets.has(platform))
      )
        context.addIssue({
          code: "custom",
          path: ["quantityPlan"],
          message: "数量目标必须覆盖全部候选平台",
        });
    }
  });

export const PurchaseTaskSchema = z.strictObject({
  id: z.uuid(),
  definition: PurchaseTaskDefinitionSchema,
  createdAt: TimestampSchema,
});

export type PurchaseTaskDefinition = z.infer<typeof PurchaseTaskDefinitionSchema>;
export type PurchaseTask = z.infer<typeof PurchaseTaskSchema>;
export type PurchaseCandidate = z.infer<typeof CandidateSchema>;
export type Specifications = z.infer<typeof SpecificationsSchema>;
