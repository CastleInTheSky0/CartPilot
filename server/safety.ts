import {
  CAPACITIES,
  COLORS,
  DEFAULT_SETTINGS,
  PLATFORMS,
  PLATFORM_INFO,
  type Platform,
  type Workspace,
  type Settings,
} from "../shared/types.ts";

export function isPlatform(value: unknown): value is Platform {
  return PLATFORMS.includes(value as Platform);
}

const DOMAINS: Record<Platform, string[]> = {
  apple: ["apple.com.cn", "apple.com"],
  taobao: ["taobao.com", "tmall.com"],
  tmall: ["tmall.com", "taobao.com"],
  jd: ["jd.com"],
  douyin: ["douyin.com", "jinritemai.com"],
};

export function isPlatformUrl(value: string, platform: Platform): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      DOMAINS[platform].some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch { return false; }
}

// Only canonical product pages are accepted. Search, login, short links and payment links are not product IDs.
export function productId(value: string, platform: Platform): string | null {
  if (!isPlatformUrl(value, platform)) return null;
  const url = new URL(value);
  if (platform === "apple") return url.hostname === "www.apple.com.cn" && /^\/shop\/buy-iphone\/iphone-duo(?:\/|$)/.test(url.pathname) ? "iphone-duo" : null;
  if (platform === "jd") {
    if (url.hostname === "item.jd.com") return url.pathname.match(/^\/(\d+)\.html$/)?.[1] ?? null;
    if (url.hostname === "item.m.jd.com") return url.pathname.match(/^\/product\/(\d+)\.html$/)?.[1] ?? null;
    return null;
  }
  const hosts = platform === "taobao" ? ["item.taobao.com", "h5.m.taobao.com", "m.taobao.com", "detail.tmall.com", "detail.m.tmall.com"] : ["detail.tmall.com", "detail.m.tmall.com"];
  if (platform === "taobao" || platform === "tmall") {
    if (!hosts.includes(url.hostname) || !/^(?:\/item.htm|\/awp\/core\/detail.htm)$/.test(url.pathname)) return null;
  } else {
    if (url.hostname === "www.douyin.com") return url.pathname.match(/^\/shopping\/product\/(\d+)\/?$/)?.[1] ?? null;
    if (url.hostname !== "haohuo.jinritemai.com" || !/^\/(?:ecommerce\/trade\/detail\/index.html|views\/product\/detail|commerce\/share\/goodsdetail\/index.html)$/.test(url.pathname)) return null;
  }
  const ids = [...url.searchParams.getAll("id"), ...url.searchParams.getAll("product_id")];
  return ids.length === 1 && /^\d+$/.test(ids[0]) ? ids[0] : null;
}

export function assertRunnable(settings: Settings): void {
  if (!productId(settings.productUrl, settings.platform)) throw new Error(`请先配置${PLATFORM_INFO[settings.platform].name}的完整商品详情链接。`);
}

export function canonicalProductUrl(value: string, platform: Platform): string {
  const id = productId(value, platform);
  if (!id) return value;
  const url = new URL(value);
  const sku = url.searchParams.get("skuId");
  url.hash = ""; url.search = "";
  if (platform === "taobao" || platform === "tmall") { url.searchParams.set("id", id); if (sku && /^\d+$/.test(sku)) url.searchParams.set("skuId", sku); }
  if (platform === "douyin" && url.hostname === "haohuo.jinritemai.com") url.searchParams.set("id", id);
  return url.toString();
}

export function isAppleUrl(value: string): boolean {
  return isPlatformUrl(value, "apple");
}

export function validateSettings(input: unknown): Settings {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("设置格式不正确。");
  const raw = input as Record<string, unknown>;
  const platform = raw.platform === undefined ? "apple" : raw.platform;
  if (!isPlatform(platform)) throw new Error("请选择有效的购买平台。");
  const url = typeof raw.productUrl === "string" ? raw.productUrl.trim() : "";
  if ((url && !productId(url, platform)) || (!url && platform === "apple"))
    throw new Error(`请输入${PLATFORM_INFO[platform].name}的完整商品详情链接，搜索页和短链接不能用于购买。`);
  if (url.length > 4000) throw new Error("商品链接过长，请使用完整商品详情页链接。");
  const backupProductUrl = raw.backupProductUrl ?? "";
  if (typeof backupProductUrl !== "string" || backupProductUrl.length > 4000 ||
    (backupProductUrl.trim() && !productId(backupProductUrl.trim(), platform))) throw new Error("备用链接必须是当前平台的完整商品详情链接。");
  const expectedSeller = raw.expectedSeller ?? "";
  if (typeof expectedSeller !== "string" || expectedSeller.length > 120) throw new Error("店铺名称需为不超过 120 字符的文本。");
  if (!COLORS.includes(raw.color as Settings["color"]))
    throw new Error("请选择有效的颜色。");
  if (!CAPACITIES.includes(raw.capacity as Settings["capacity"]))
    throw new Error("请选择有效的存储容量。");
  if (
    typeof raw.launchAt !== "string" ||
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(raw.launchAt) ||
    !Number.isFinite(Date.parse(raw.launchAt))
  )
    throw new Error("请设置包含时区的开售时间。");
  if (raw.quantity !== 1) throw new Error("每次任务仅支持购买 1 台。");
  if (
    typeof raw.maxTotal !== "number" ||
    !Number.isFinite(raw.maxTotal) ||
    raw.maxTotal < 1 ||
    raw.maxTotal > 100000 ||
    Math.abs(Math.round(raw.maxTotal * 100) - raw.maxTotal * 100) > 0.000001
  )
    throw new Error("订单总价上限需在 1 至 100,000 元之间，最多两位小数。");
  if (
    typeof raw.autoSubmit !== "boolean" ||
    typeof raw.notifications !== "boolean"
  )
    throw new Error("开关设置格式不正确。");
  if (
    !Number.isInteger(raw.pollSeconds) ||
    (raw.pollSeconds as number) < 3 ||
    (raw.pollSeconds as number) > 60
  )
    throw new Error("检查间隔需为 3 至 60 秒。");
  const refreshSeconds = raw.refreshSeconds ?? DEFAULT_SETTINGS.refreshSeconds;
  const launchRefreshSeconds = raw.launchRefreshSeconds ?? DEFAULT_SETTINGS.launchRefreshSeconds;
  if (!Number.isInteger(refreshSeconds) || (refreshSeconds as number) < 60 || (refreshSeconds as number) > 600)
    throw new Error("日常页面刷新间隔需为 60 至 600 秒。");
  if (!Number.isInteger(launchRefreshSeconds) || (launchRefreshSeconds as number) < 15 || (launchRefreshSeconds as number) > 120)
    throw new Error("开售窗口页面刷新间隔需为 15 至 120 秒。");
  if (
    !Number.isInteger(raw.maxMinutes) ||
    (raw.maxMinutes as number) < 1 ||
    (raw.maxMinutes as number) > 120
  )
    throw new Error("最长运行时间需为 1 至 120 分钟。");
  if (
    !raw.selectors ||
    typeof raw.selectors !== "object" ||
    Array.isArray(raw.selectors)
  )
    throw new Error("高级选择器格式不正确。");
  const selectors = { ...DEFAULT_SETTINGS.selectors };
  for (const key of Object.keys(selectors) as (keyof typeof selectors)[]) {
    const value = (raw.selectors as Record<string, unknown>)[key] ?? "";
    if (typeof value !== "string" || value.length > 500)
      throw new Error("选择器必须为不超过 500 字符的文本。");
    selectors[key] = value.trim();
  }
  return {
    platform,
    productUrl: canonicalProductUrl(url, platform),
    backupProductUrl: backupProductUrl.trim() ? canonicalProductUrl(backupProductUrl.trim(), platform) : "",
    expectedSeller: expectedSeller.trim(),
    color: raw.color as Settings["color"],
    capacity: raw.capacity as Settings["capacity"],
    launchAt: raw.launchAt,
    quantity: 1,
    maxTotal: raw.maxTotal,
    autoSubmit: raw.autoSubmit,
    pollSeconds: raw.pollSeconds as number,
    refreshSeconds: refreshSeconds as number,
    launchRefreshSeconds: launchRefreshSeconds as number,
    maxMinutes: raw.maxMinutes as number,
    notifications: raw.notifications,
    selectors,
  };
}

export function validateWorkspace(input: unknown): Workspace {
  if (!input || typeof input !== "object") throw new Error("工作空间格式不正确。");
  const raw = input as Workspace;
  if (raw.version !== 2 || !isPlatform(raw.activePlatform) || !["single", "race"].includes(raw.mode) ||
    !Array.isArray(raw.enabledPlatforms) || !raw.enabledPlatforms.length ||
    raw.enabledPlatforms.some((platform) => !isPlatform(platform)) || new Set(raw.enabledPlatforms).size !== raw.enabledPlatforms.length ||
    !raw.plans || typeof raw.plans !== "object") throw new Error("平台配置不正确。");
  const plans = Object.fromEntries(PLATFORMS.map((platform) => {
    const plan = validateSettings(raw.plans[platform]);
    if (plan.platform !== platform) throw new Error("平台与配置不一致。");
    return [platform, plan];
  })) as Workspace["plans"];
  return { version: 2, activePlatform: raw.activePlatform, mode: raw.mode, enabledPlatforms: [...raw.enabledPlatforms], plans };
}

export function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\s\u00a0\u200b]/g, "")
    .toLowerCase();
}

// Accept only one explicit CNY amount. Never guess between installment prices, totals, or other currencies.
export function parseCny(value: string): number | null {
  const normalized = value.normalize("NFKC");
  if (
    /\$|USD|HKD|港币|港幣|美元|每月|\/月|per\s*month|起|至少/i.test(normalized)
  )
    return null;
  const matches = [
    ...normalized.matchAll(
      /(?:RMB|CNY|人民币|人民幣|¥|￥)\s*([\d][\d,.]*)|([\d][\d,.]*)\s*元/gi,
    ),
  ];
  if (matches.length !== 1) return null;
  const remainder =
    normalized.slice(0, matches[0].index) +
    normalized.slice(matches[0].index! + matches[0][0].length);
  if (/\d/.test(remainder)) return null;
  const number = matches[0][1] ?? matches[0][2];
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(number)) return null;
  const result = Number(number.replaceAll(",", ""));
  return Number.isFinite(result) && result > 0 ? result : null;
}

export type OrderEvidence = {
  items: { name: string; quantity: number | null; productIds?: string[]; seller?: string | null }[];
  total: number | null;
  checkout: boolean;
  installment: boolean;
  deposit?: boolean;
};

export function validateOrder(
  evidence: OrderEvidence,
  settings: Settings,
): string | null {
  if (!evidence.checkout) return "当前页面不是已识别的订单结账页。";
  if (evidence.installment) return "页面包含分期付款，需你手动核对付款条件。";
  if (evidence.deposit) return "页面包含定金、尾款或预售付款条件，请人工核对后下单。";
  if (evidence.items.length !== 1)
    return "购物袋必须仅有 1 项商品，请移除其他商品后重试。";
  const item = evidence.items[0];
  if (settings.platform !== "apple") {
    const expected = productId(settings.productUrl, settings.platform);
    if (!expected || item.productIds?.length !== 1 || item.productIds[0] !== expected)
      return "结账商品编号与配置链接无法唯一匹配，请在平台核对商品。";
  }
  if (settings.expectedSeller && normalize(item.seller ?? "") !== normalize(settings.expectedSeller))
    return "订单店铺与指定店铺不一致或无法读取，请核对店铺。";
  const name = normalize(item.name);
  const capacities =
    name.match(/(?<!\d)(?:256gb|512gb|1tb|2tb)(?![a-z0-9])/g) ?? [];
  const colors = COLORS.filter((color) => name.includes(normalize(color)));
  if (
    !name.includes("iphoneduo") ||
    colors.length !== 1 ||
    colors[0] !== settings.color ||
    capacities.length !== 1 ||
    capacities[0] !== normalize(settings.capacity)
  )
    return "商品名称、颜色或容量无法与所选配置完整匹配。";
  if (item.quantity !== 1) return "无法确认商品数量恰好为 1 台。";
  if (
    evidence.total === null ||
    !Number.isFinite(evidence.total) ||
    evidence.total <= 0
  )
    return "无法读取唯一、明确的人民币订单总价。";
  if (evidence.total > settings.maxTotal)
    return `订单总价 ¥${evidence.total.toLocaleString("zh-CN")} 超过上限 ¥${settings.maxTotal.toLocaleString("zh-CN")}。`;
  return null;
}

export function publicUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "";
  }
}

export function fingerprint(settings: Settings): string {
  return `iPhone Duo|${settings.color}|${settings.capacity}|1`;
}
