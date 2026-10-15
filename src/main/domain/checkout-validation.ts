import type { CheckoutEvidence, CheckoutResources } from "../../shared/contracts/purchase-order.ts";
import type {
  PurchaseCandidate,
  PurchaseTaskDefinition,
} from "../../shared/contracts/purchase-task.ts";
import { PurchaseError } from "./purchase-error.ts";

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\s\u200b]/g, "")
    .toLowerCase();
}

export function validateCheckout(
  task: PurchaseTaskDefinition,
  candidate: PurchaseCandidate,
  quantity: number,
  evidence: CheckoutEvidence,
  now: number,
  requireCheckout = true,
): void {
  const age = now - Date.parse(evidence.observedAt);
  if (age < -5_000 || age > 30_000)
    throw new PurchaseError("stale_evidence", "页面证据已过期，请重新读取真实页面。");
  if (requireCheckout && !evidence.isCheckout)
    throw new PurchaseError("not_checkout", "当前页面不是已识别的结账页。");
  if (!["full_payment", "reserved_full_payment"].includes(evidence.orderKind))
    throw new PurchaseError("manual_handoff", "当前购买方式需要人工接手。");
  if (evidence.itemCount !== 1)
    throw new PurchaseError("multiple_items", "订单必须仅含当前目标商品。");
  if (
    !candidate.productId ||
    candidate.productId !== evidence.productId ||
    (candidate.skuId !== null && candidate.skuId !== evidence.skuId)
  )
    throw new PurchaseError("product_mismatch", "商品身份或 SKU 未能与当前购买目标一致。");
  const actual = new Map(
    Object.entries(evidence.specifications).map(([key, value]) => [
      normalize(key),
      normalize(value),
    ]),
  );
  if (
    Object.entries(task.product.specifications).some(
      ([key, value]) => actual.get(normalize(key)) !== normalize(value),
    )
  )
    throw new PurchaseError("specification_mismatch", "商品规格与任务目标不一致。");
  if (
    candidate.expectedSeller !== null &&
    normalize(candidate.expectedSeller) !== normalize(evidence.seller ?? "")
  )
    throw new PurchaseError("seller_mismatch", "店铺与任务要求不一致或无法读取。");
  if (evidence.quantity !== quantity)
    throw new PurchaseError("quantity_mismatch", "页面数量与本次预留数量不一致。");
  if (
    evidence.unitPriceCents === null ||
    evidence.payableTotalCents === null ||
    !evidence.shippingIncluded
  )
    throw new PurchaseError("unclear_price", "优惠后商品单价或含运费的最终应付金额无法核对。");
  if (evidence.unitPriceCents > task.budget.maxUnitPriceCents)
    throw new PurchaseError("unit_price_exceeded", "商品单价超过每件最高价。");
  const merchandise = evidence.unitPriceCents * quantity;
  if (!Number.isSafeInteger(merchandise) || evidence.payableTotalCents < merchandise)
    throw new PurchaseError(
      "inconsistent_price",
      "商品单价与最终应付金额不一致，请重新核对优惠与运费。",
    );
}

export function checkoutResourceKeys(
  resources: CheckoutResources,
  candidate: PurchaseCandidate,
): string[] {
  const family = candidate.platform === "tmall" ? "taobao" : candidate.platform;
  return [
    JSON.stringify(["tab", resources.browserSessionId, resources.tabId]),
    JSON.stringify(["account", resources.profileId, family]),
  ];
}
