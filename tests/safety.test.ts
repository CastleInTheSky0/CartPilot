import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, defaultPlan, defaultWorkspace, type Settings } from "../shared/types.ts";
import {
  isAppleUrl,
  isPlatformUrl,
  productId,
  validateWorkspace,
  parseCny,
  publicUrl,
  validateOrder,
  validateSettings,
  type OrderEvidence,
} from "../server/safety.ts";

test("only HTTPS Apple-owned domains are accepted for automation", () => {
  for (const value of [
    "https://www.apple.com.cn/shop/bag",
    "https://secure.store.apple.com.cn/shop/checkout",
    "https://idmsa.apple.com/",
  ])
    assert.equal(isAppleUrl(value), true, value);
  for (const value of [
    "http://www.apple.com.cn/",
    "https://apple.com.cn.evil.test/",
    "https://evilapple.com/",
    "https://user:pass@www.apple.com.cn/",
    "https://www.apple.com.cn:444/",
    "javascript:alert(1)",
    "file:///C:/test",
  ])
    assert.equal(isAppleUrl(value), false, value);
});

test("marketplace domains and listing IDs reject cross-platform, spoofed and non-product URLs", () => {
  const links = {
    jd: "https://item.jd.com/100414360202.html",
    taobao: "https://item.taobao.com/item.htm?id=123456789",
    tmall: "https://detail.tmall.com/item.htm?id=123456789",
    douyin: "https://haohuo.jinritemai.com/views/product/detail?id=123456789",
  } as const;
  for (const [platform, url] of Object.entries(links)) {
    const id = platform as keyof typeof links;
    assert.ok(productId(url, id));
    assert.equal(isPlatformUrl(url.replace("https:", "http:"), id), false);
    const spoofed = new URL(url); spoofed.hostname += ".example.com";
    assert.equal(productId(spoofed.href, id), null);
    assert.equal(productId(url.replace("https://", "https://user:pass@"), id), null);
  }
  assert.equal(productId(links.jd, "taobao"), null);
  assert.equal(productId(links.tmall, "taobao"), "123456789");
  assert.equal(productId(links.taobao, "tmall"), null);
  assert.equal(productId("https://s.taobao.com/search?q=iPhone", "taobao"), null);
  assert.equal(productId("https://v.douyin.com/abc", "douyin"), null);
  assert.equal(productId(`${links.tmall}&id=999`, "tmall"), null);
  assert.equal(productId("https://item.jd.com/100414360202.html.evil", "jd"), null);
});

test("workspace migration preserves Apple settings and creates separate unconfigured channels", () => {
  const legacy = structuredClone(DEFAULT_SETTINGS) as Partial<Settings>;
  delete legacy.platform; delete legacy.expectedSeller; delete legacy.backupProductUrl;
  delete (legacy.selectors as Partial<Settings["selectors"]>).quantity;
  const migrated = validateSettings(legacy);
  assert.deepEqual(migrated, DEFAULT_SETTINGS);
  const workspace = validateWorkspace(defaultWorkspace(migrated));
  assert.equal(workspace.plans.jd.productUrl, "");
  workspace.plans.jd.selectors.submit = "#jd-only";
  assert.equal(workspace.plans.apple.selectors.submit, "");
  assert.throws(() => validateWorkspace({ ...workspace, enabledPlatforms: ["jd", "jd"] }));
  assert.throws(() => validateWorkspace({ ...workspace, enabledPlatforms: ["bad"] }));
});

test("marketplace settings canonicalize product URLs and require identity and optional seller at checkout", () => {
  const settings = validateSettings({ ...defaultPlan("jd"), productUrl: "https://item.jd.com/100414360202.html?pcdk=tracking#section", expectedSeller: "Apple产品京东自营旗舰店" });
  assert.equal(settings.productUrl, "https://item.jd.com/100414360202.html");
  const evidence: OrderEvidence = { items: [{ name: "iPhone Duo 256GB 星光白色", quantity: 1, productIds: ["100414360202"], seller: settings.expectedSeller }], total: 15999, checkout: true, installment: false };
  assert.equal(validateOrder(evidence, settings), null);
  assert.match(validateOrder({ ...evidence, deposit: true }, settings)!, /定金/);
  assert.match(validateOrder({ ...evidence, items: [{ ...evidence.items[0], productIds: ["999"] }] }, settings)!, /商品编号/);
  assert.match(validateOrder({ ...evidence, items: [{ ...evidence.items[0], productIds: ["100414360202", "999"] }] }, settings)!, /商品编号/);
  assert.match(validateOrder({ ...evidence, items: [{ ...evidence.items[0], seller: "其他店铺" }] }, settings)!, /店铺/);
});

test("settings reject wrong products, invalid times, counts and budgets", () => {
  assert.deepEqual(validateSettings(DEFAULT_SETTINGS), DEFAULT_SETTINGS);
  const invalid: Partial<Settings>[] = [
    { productUrl: "https://www.apple.com.cn/shop/buy-iphone/iphone-18-pro" },
    { productUrl: "https://www.apple.com.cn/shop/buy-iphone/iphone-duo-fake" },
    { launchAt: "2026-10-16T20:00" },
    { launchAt: "bad+08:00" },
    { color: "红色" as Settings["color"] },
    { quantity: 2 as 1 },
    { maxTotal: Infinity },
    { maxTotal: 0 },
    { maxTotal: 100001 },
    { maxTotal: 15000.123 },
    { pollSeconds: 1 },
    { pollSeconds: 3.5 },
    { maxMinutes: 0 },
    { maxMinutes: 121 },
    { autoSubmit: "true" as unknown as boolean },
  ];
  for (const change of invalid)
    assert.throws(
      () => validateSettings({ ...DEFAULT_SETTINGS, ...change }),
      JSON.stringify(change),
    );
});

test("prices require one unambiguous RMB total", () => {
  for (const value of [
    "RMB 15,999",
    "¥15,999.00",
    "人民币 15999",
    "15999 元",
    "￥１５，９９９",
  ])
    assert.equal(parseCny(value), 15999, value);
  for (const value of [
    "15,999",
    "USD 15999",
    "HKD 15999",
    "¥667/月",
    "RMB 15999 起",
    "RMB 15,99",
    "RMB 15999 / RMB 667",
    "RMB 0",
    "$15999",
    "RMB 15999.999",
    "RMB 15999 或 667",
    "",
  ])
    assert.equal(parseCny(value), null, value);
});

const valid: OrderEvidence = {
  items: [{ name: "iPhone Duo 256 GB 星光白色", quantity: 1 }],
  total: 15999,
  checkout: true,
  installment: false,
};
test("final order requires exactly one matching item, known quantity and in-budget total", () => {
  assert.equal(validateOrder(valid, DEFAULT_SETTINGS), null);
  const invalid: Partial<OrderEvidence>[] = [
    { items: [] },
    { items: [valid.items[0], valid.items[0]] },
    { items: [{ name: "iPhone 18 Pro 256GB 星光白色", quantity: 1 }] },
    { items: [{ name: "iPhone Duo 512GB 星光白色", quantity: 1 }] },
    { items: [{ name: "iPhone Duo 256GB 夜空色", quantity: 1 }] },
    { items: [{ name: "iPhone Duo 256GB 512GB 星光白色", quantity: 1 }] },
    { items: [{ name: "iPhone Duo 256GB 夜空色 星光白色", quantity: 1 }] },
    { items: [{ name: valid.items[0].name, quantity: null }] },
    { items: [{ name: valid.items[0].name, quantity: 2 }] },
    { total: null },
    { total: 16000 },
    { total: NaN },
    { total: -1 },
    { checkout: false },
    { installment: true },
  ];
  for (const change of invalid)
    assert.equal(
      typeof validateOrder({ ...valid, ...change }, DEFAULT_SETTINGS),
      "string",
      JSON.stringify(change),
    );
});

test("URLs shown in logs never include tokens or query parameters", () => {
  assert.equal(
    publicUrl(
      "https://secure.store.apple.com.cn/shop/checkout?token=secret#address",
    ),
    "https://secure.store.apple.com.cn/shop/checkout",
  );
});
