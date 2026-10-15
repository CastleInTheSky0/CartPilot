import { randomUUID } from "node:crypto";
import {
  AccessFamilySchema,
  LegacyAccessStateSchema,
  LegacyConnectionSchema,
  LegacySettingsSchema,
  LegacySubmissionSchema,
  LegacyWorkspaceSchema,
  type AccessRestriction,
} from "../../../shared/contracts/legacy-import.ts";
import {
  PurchaseTaskDefinitionSchema,
  type PurchaseTaskDefinition,
} from "../../../shared/contracts/purchase-task.ts";
import type { LegacySnapshot } from "./legacy-snapshot.ts";
import type { ConnectBrowserInput } from "../../../shared/contracts/browser.ts";

export function convertLegacySnapshot(snapshot: LegacySnapshot): {
  definition: PurchaseTaskDefinition | null;
  restrictions: AccessRestriction[];
  issues: string[];
  browserPreferences: ConnectBrowserInput | null;
} {
  const issues: string[] = [];
  let definition: PurchaseTaskDefinition | null = null;
  const restrictions: AccessRestriction[] = [];
  let browserPreferences: ConnectBrowserInput | null = null;
  const json = (name: string): unknown =>
    JSON.parse((snapshot.files.get(name)?.toString("utf8") ?? "null").replace(/^\uFEFF/, ""));
  try {
    const workspace = snapshot.files.has("workspace.json")
      ? LegacyWorkspaceSchema.parse(json("workspace.json"))
      : null;
    const plans = workspace
      ? (workspace.mode === "single" ? [workspace.activePlatform] : workspace.enabledPlatforms).map(
          (platform) => workspace.plans[platform],
        )
      : snapshot.files.has("settings.json")
        ? [LegacySettingsSchema.parse(json("settings.json"))]
        : [];
    if (!plans.length) throw new Error("未发现可迁移的旧购买配置。");
    const first = plans[0];
    if (plans.some((plan) => !plan.productUrl.trim()))
      throw new Error("旧启用渠道缺少商品详情链接，需先核对配置。");
    if (
      plans.some(
        (plan) =>
          plan.color !== first.color ||
          plan.capacity !== first.capacity ||
          plan.quantity !== first.quantity ||
          plan.maxTotal !== first.maxTotal ||
          plan.autoSubmit !== first.autoSubmit ||
          plan.maxMinutes !== first.maxMinutes,
      )
    )
      throw new Error(
        "旧渠道的规格、数量、预算、提交方式或运行时限不一致，需人工核对，未自动合并。",
      );
    definition = PurchaseTaskDefinitionSchema.parse({
      version: 1,
      name: "旧版购买目标",
      product: { name: "iPhone Duo", specifications: { 颜色: first.color, 容量: first.capacity } },
      candidates: plans.flatMap((plan) =>
        [plan.productUrl, plan.backupProductUrl].filter(Boolean).map((productUrl) => ({
          id: randomUUID(),
          platform: plan.platform,
          productUrl,
          productId: null,
          skuId: null,
          expectedSeller: plan.expectedSeller || null,
          launchAt: plan.launchAt,
        })),
      ),
      quantityPlan: { mode: "total", targetQuantity: first.quantity },
      orderQuantity: first.quantity,
      allowPartial: false,
      budget: {
        currency: "CNY",
        maxUnitPriceCents: Math.round(first.maxTotal * 100),
        totalBudgetCents: Math.round(first.maxTotal * 100),
      },
      submissionMode: first.autoSubmit ? "automatic" : "manual",
      schedule: { launchAt: first.launchAt, maxRunMinutes: first.maxMinutes },
    });
  } catch (error) {
    issues.push(
      error instanceof Error && !("issues" in error)
        ? error.message
        : "旧购买配置格式不正确，请在备份中核对原始设置。",
    );
  }
  if (snapshot.files.has("submission.json")) {
    try {
      const submission = LegacySubmissionSchema.parse(json("submission.json"));
      issues.push(
        `旧版保留一条${submission.result === "confirmed" ? "已识别确认" : "结果未知"}的提交记录，但缺少可关联当前意图的有效订单号与商品数量证据；全局暂停新增购买，等待核对。`,
      );
    } catch {
      issues.push("旧提交记录无法读取，全局暂停新增购买，请核对备份中的 submission.json。");
    }
  }
  if (snapshot.files.has("access-state.json")) {
    try {
      const state = LegacyAccessStateSchema.parse(json("access-state.json"));
      for (const [family, restriction] of Object.entries(state.restrictions)) {
        if (restriction)
          restrictions.push({
            ...restriction,
            family: AccessFamilySchema.parse(family),
          });
      }
    } catch {
      issues.push("旧访问冷却记录无法读取，请核对后恢复购买。");
    }
  }
  if (snapshot.files.has("browser-connection.json")) {
    try {
      const connection = LegacyConnectionSchema.parse(json("browser-connection.json"));
      browserPreferences = {
        profileDirectory: connection.mode === "extension" ? connection.profileDirectory : null,
      };
    } catch {
      issues.push("旧浏览器配置无法读取，请核对后重新接入扩展。");
    }
  }
  return { definition, restrictions, issues, browserPreferences };
}
