import { randomUUID } from "node:crypto";
import {
  PurchaseTaskDefinitionSchema,
  type PurchaseTaskDefinition,
} from "../../src/shared/contracts/purchase-task.ts";

export function purchaseDefinition(
  overrides: Partial<PurchaseTaskDefinition> = {},
): PurchaseTaskDefinition {
  return PurchaseTaskDefinitionSchema.parse({
    version: 1,
    name: "运动鞋购买目标",
    product: { name: "跑鞋", specifications: { 尺码: "42", 颜色: "黑色" } },
    candidates: ["jd", "tmall"].map((platform) => ({
      id: randomUUID(),
      platform,
      productUrl:
        platform === "jd"
          ? "https://item.jd.com/123.html"
          : "https://detail.tmall.com/item.htm?id=456",
      productId: platform === "jd" ? "123" : "456",
      skuId: null,
      expectedSeller: "品牌旗舰店",
    })),
    quantityPlan: { mode: "total", targetQuantity: 3 },
    orderQuantity: 2,
    budget: { currency: "CNY", maxUnitPriceCents: 50_000, totalBudgetCents: 150_000 },
    submissionMode: "manual",
    schedule: { launchAt: "2026-10-16T20:00:00+08:00", maxRunMinutes: 20 },
    ...overrides,
  });
}
