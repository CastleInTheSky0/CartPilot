import type { Platform, Settings } from "../shared/types.ts";
import { accessFamily } from "./access.ts";
import { productId } from "./safety.ts";

export const LAUNCH_WINDOW_MS = 2 * 60_000;
export function refreshInterval(settings: Settings, launch: number, now: number): number {
  return (Math.abs(now - launch) <= LAUNCH_WINDOW_MS ? settings.launchRefreshSeconds : settings.refreshSeconds) * 1000;
}
export function networkBackoff(failures: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, failures - 1), 300_000);
}
const listingKey = (url: string, platform: Platform) => `${accessFamily(platform)}:${productId(url, platform)}`;
const intent = (settings: Settings) => JSON.stringify([
  settings.color, settings.capacity, settings.quantity, settings.maxTotal, settings.autoSubmit,
  Date.parse(settings.launchAt), settings.expectedSeller, settings.selectors,
]);

// A shared Taobao/Tmall listing uses the Tmall execution profile. Conflicting
// purchase instructions must be reconciled before any browser is opened.
export function deduplicatePlans(input: Settings[]): { plans: Settings[]; merged: Partial<Record<Platform, Platform>> } {
  const plans: Settings[] = [];
  const merged: Partial<Record<Platform, Platform>> = {};
  const seen = new Map<string, Settings>();
  const ordered = [...input].sort((a, b) => Number(a.platform === "taobao") - Number(b.platform === "taobao"));
  for (const original of ordered) {
    const settings = structuredClone(original);
    const key = listingKey(settings.productUrl, settings.platform);
    const prior = seen.get(key);
    if (!prior) { seen.set(key, settings); plans.push(settings); continue; }
    if (intent(prior) !== intent(settings)) throw new Error("淘宝与天猫的同一商品存在不同购买配置，请统一规格、预算、开售时间、店铺与自动提交设置后启动。");
    const firstBackup = prior.backupProductUrl && listingKey(prior.backupProductUrl, prior.platform);
    const secondBackup = settings.backupProductUrl && listingKey(settings.backupProductUrl, settings.platform);
    if (firstBackup && secondBackup && firstBackup !== secondBackup) throw new Error("同一商品配置了不同备用链接，请统一淘宝与天猫的备用链接后启动。");
    if (!firstBackup && secondBackup) {
      if (!productId(settings.backupProductUrl, prior.platform)) throw new Error("合并后的执行渠道无法使用此备用链接，请统一淘宝与天猫的商品链接。");
      prior.backupProductUrl = settings.backupProductUrl;
    }
    merged[settings.platform] = prior.platform;
  }
  // A backup owned as another worker's primary is already being observed there.
  const owned = new Set(plans.map((plan) => listingKey(plan.productUrl, plan.platform)));
  for (const plan of plans) if (plan.backupProductUrl) {
    const key = listingKey(plan.backupProductUrl, plan.platform);
    if (owned.has(key)) plan.backupProductUrl = "";
    else owned.add(key);
  }
  return { plans, merged };
}
