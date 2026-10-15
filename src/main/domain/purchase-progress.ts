import type { Platform } from "../../shared/contracts/browser.ts";
import type { PurchaseTaskDefinition } from "../../shared/contracts/purchase-task.ts";
import { PurchaseError } from "./purchase-error.ts";

export interface PurchaseUsage {
  platform: Platform;
  quantity: number;
  amountCents: number;
  status: "reserved" | "pending" | "confirmed" | "released";
}

function sum(values: number[]): number {
  const total = values.reduce((result, value) => result + value, 0);
  if (!Number.isSafeInteger(total))
    throw new PurchaseError("overflow", "累计数量或金额超出精确计算范围。");
  return total;
}

export function purchaseProgress(task: PurchaseTaskDefinition, usage: PurchaseUsage[]) {
  const platforms = [...new Set(task.candidates.map((candidate) => candidate.platform))];
  const held = usage.filter((item) => item.status !== "released");
  const confirmed = held.filter((item) => item.status === "confirmed");
  const targetQuantity =
    task.quantityPlan.mode === "total"
      ? task.quantityPlan.targetQuantity
      : sum(task.quantityPlan.targets.map((target) => target.quantity));
  const byPlatform = platforms.map((platform) => {
    const platformUsage = held.filter((item) => item.platform === platform);
    const target =
      task.quantityPlan.mode === "per_platform"
        ? (task.quantityPlan.targets.find((item) => item.platform === platform)?.quantity ?? 0)
        : null;
    return {
      platform,
      targetQuantity: target,
      confirmedQuantity: sum(
        platformUsage.filter((item) => item.status === "confirmed").map((item) => item.quantity),
      ),
      pendingQuantity: sum(
        platformUsage.filter((item) => item.status === "pending").map((item) => item.quantity),
      ),
      reservedQuantity: sum(
        platformUsage.filter((item) => item.status === "reserved").map((item) => item.quantity),
      ),
      remainingQuantity:
        target === null
          ? null
          : Math.max(0, target - sum(platformUsage.map((item) => item.quantity))),
    };
  });
  const confirmedQuantity = sum(confirmed.map((item) => item.quantity));
  const heldQuantity = sum(held.map((item) => item.quantity));
  const spentCents = sum(confirmed.map((item) => item.amountCents));
  const heldCents = sum(held.map((item) => item.amountCents));
  return {
    targetQuantity,
    confirmedQuantity,
    heldQuantity,
    spentCents,
    heldCents,
    remainingQuantity: Math.max(0, targetQuantity - heldQuantity),
    remainingBudgetCents: Math.max(0, task.budget.totalBudgetCents - heldCents),
    isComplete: confirmedQuantity >= targetQuantity,
    byPlatform,
  };
}

export function reservationQuantity(
  task: PurchaseTaskDefinition,
  platform: Platform,
  usage: PurchaseUsage[],
  availableQuantity: number,
): number {
  const progress = purchaseProgress(task, usage);
  const remaining =
    task.quantityPlan.mode === "total"
      ? progress.remainingQuantity
      : (progress.byPlatform.find((item) => item.platform === platform)?.remainingQuantity ?? 0);
  if (remaining <= 0)
    throw new PurchaseError("quota_exhausted", "目标数量已下单或被未决订单占用。");
  const quantity = Math.min(task.orderQuantity, remaining, availableQuantity);
  if (quantity <= 0) throw new PurchaseError("unavailable", "页面没有可购买数量。");
  if (!task.allowPartial && quantity < task.orderQuantity)
    throw new PurchaseError(
      "partial_disabled",
      "剩余配额、库存或限购不足单笔数量；任务未允许减量。",
    );
  return quantity;
}
