import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { defaultPlan, defaultWorkspace, type Platform, type Settings } from "../shared/types.ts";

process.env.DUO_DATA_DIR = path.resolve("output", "tests", randomUUID());
const { initStore, readSubmission } = await import("../server/store.ts");
const { TaskRunner } = await import("../server/runner.ts");
const { createBrowser } = await import("../server/marketplace.ts");
const { AccessGuard } = await import("../server/access.ts");
let browser: Browser;
before(async () => { await initStore(); browser = await chromium.launch({ headless: true, channel: "chromium" }); });
after(async () => { await browser?.close(); });

const targets = {
  jd: { product: "https://item.jd.com/100414360202.html", checkout: "https://trade.jd.com/shopping/order/getOrderInfo.action", success: "https://success.jd.com/success/success.action", id: "100414360202" },
  taobao: { product: "https://item.taobao.com/item.htm?id=123456789", checkout: "https://buy.taobao.com/order/confirm_order.htm", success: "https://buy.taobao.com/order/order_success.htm", id: "123456789" },
  tmall: { product: "https://detail.tmall.com/item.htm?id=987654321", checkout: "https://buy.tmall.com/order/confirm_order.htm", success: "https://buy.tmall.com/order/order_success.htm", id: "987654321" },
  douyin: { product: "https://haohuo.jinritemai.com/views/product/detail?id=111222333", checkout: "https://haohuo.jinritemai.com/ecommerce/trade/confirm/index.html", success: "https://haohuo.jinritemai.com/ecommerce/trade/success/index.html", id: "111222333" },
};
type Market = keyof typeof targets;
type Options = { challenge?: boolean; uncertain?: boolean; wrongId?: boolean; duplicate?: boolean; slow?: boolean; deposit?: boolean; soldOutPrimary?: boolean; unavailable?: boolean; restrictedStatus?: number; retryAfter?: string; networkFailure?: boolean };
const html = (body: string) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>button,li,[role=option],.first-row{display:block;padding:10px}a{display:block}</style></head><body><main>${body}</main></body></html>`;

async function fixture(platform: Market, options: Options = {}) {
  const context = await browser.newContext(); const target = targets[platform];
  const counts = { entry: 0, submit: 0, product: 0 };
  const visited: string[] = [];
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url()); let body = "";
    if (url.pathname === "/submitted") { counts.submit++; return route.fulfill({ status: 200, body: "ok" }); }
    const isProduct = url.origin + url.pathname === new URL(target.product).origin + new URL(target.product).pathname || options.soldOutPrimary && platform === "jd" && url.href === target.product.replace(target.id, "222333444");
    if (isProduct) {
      counts.product++;
      if (options.networkFailure) { await route.abort(); return; }
      visited.push(url.href);
      if (options.slow) await delay(180);
      const unavailable = options.unavailable || options.soldOutPrimary && url.pathname === new URL(target.product).pathname;
      const action = `onclick="location.href='${target.checkout}?selected=${url.pathname.includes("222333444") ? "222333444" : target.id}'"`;
      const buy = unavailable ? "" : platform === "jd" ? `<div class="bottom-btns-root"><div class="first-row" ${action}>立即抢购</div></div>` : platform === "douyin" ? `<button data-e2e="buy-now" ${action}>立即购买</button>` : `<a id="J_LinkBuy" href="${target.checkout}">立即购买</a>`;
      const title = platform === "jd" ? '<div class="sku-title-name">Apple iPhone Duo 手机 256GB 星光白色</div>' : platform === "douyin" ? '<h1 data-e2e="product-title">Apple iPhone Duo</h1>' : '<h1>Apple iPhone Duo</h1>';
      const choices = platform === "jd" ? '<div class="specification-item-sku specification-item-sku--selected">星光白色</div><div class="specification-item-sku specification-item-sku--selected">256GB</div>' :
        '<ul class="tb-sku"><li role="option" aria-selected="true">星光白色</li><li role="option" aria-selected="true">256GB</li></ul>';
      body = options.challenge ? "<h1>安全验证</h1>" : `${title}${options.deposit ? "<p>预售定金 ¥100</p>" : ""}${choices}${buy}`;
    } else if (url.origin + url.pathname === target.checkout) {
      counts.entry++;
      const selectedId = url.searchParams.get("selected") ?? target.id;
      const link = target.product.replace(target.id, options.wrongId ? "555555555" : selectedId);
      const sku = options.wrongId ? "555555555" : selectedId;
      const item = platform === "jd" ? `<div class="goods-list"><div class="goods-item" data-sku="${sku}"><a href="${link}">iPhone Duo 256GB 星光白色</a><span class="p-num">1</span></div></div>` :
        `<div class="order-order"><div class="order-item" data-testid="order-item" data-e2e="order-product"><a href="${link}">iPhone Duo 256GB 星光白色</a><span class="item-quantity" data-e2e="quantity">1</span></div></div>`;
      const submitAction = `onclick="fetch('/submitted',{method:'POST'}).then(()=>{${options.uncertain ? "this.disabled=true" : `location.href='${target.success}'`}})"`;
      body = `${item}${options.duplicate ? item : ""}<span id="sumPayPriceId" class="realPay-price" data-e2e="order-total">¥15,999.00</span><button id="order-submit" class="go-btn" data-e2e="submit-order" ${submitAction}>提交订单</button>`;
    } else if (url.origin + url.pathname === target.success) body = "<h1>订单提交成功</h1><p>订单号：TEST123456789</p>";
    else { await route.abort(); return; }
    await route.fulfill({ status: isProduct ? options.restrictedStatus ?? 200 : 200, headers: options.retryAfter ? { 'Retry-After': options.retryAfter } : {}, contentType: "text/html; charset=utf-8", body: html(body) });
  });
  await context.newPage();
  const settings: Settings = { ...defaultPlan(platform), productUrl: target.product, autoSubmit: true, pollSeconds: 3 };
  return { context, counts, settings, visited };
}

async function setup(platforms: Market[], options: Partial<Record<Market, Options>> = {}) {
  const fixtures = new Map<Platform, Awaited<ReturnType<typeof fixture>>>();
  for (const platform of platforms) fixtures.set(platform, await fixture(platform, options[platform]));
  const settings = fixtures.get(platforms[0])!.settings;
  const workspace = defaultWorkspace(settings); workspace.mode = "race"; workspace.enabledPlatforms = platforms;
  for (const [platform, item] of fixtures) workspace.plans[platform] = item.settings;
  const runner = new TaskRunner(settings, [], null, workspace, (platform, onChange) => {
    const driver = createBrowser(platform, onChange); driver.context = fixtures.get(platform)!.context; return driver;
  }, new AccessGuard({ globalGapMs: 0, familyGapMs: 0 }));
  return { runner, fixtures, close: async () => { await runner.stop(); await Promise.allSettled([...fixtures.values()].map((item) => item.context.close())); } };
}
async function until(predicate: () => boolean, runner: InstanceType<typeof TaskRunner>) {
  const deadline = Date.now() + 18000;
  while (!predicate()) { if (Date.now() > deadline || runner.state.phase === "error") throw new Error(`${runner.state.phase}: ${runner.state.message}; ${runner.state.logs.slice(-5).map((log) => log.message).join(" | ")}`); await delay(25); }
}

for (const platform of ["jd", "taobao", "tmall", "douyin"] as Market[]) test(`${platform} direct checkout verifies product identity and submits once in isolated pages`, async () => {
  const app = await setup([platform]);
  try {
    const driver = app.runner.getBrowser(platform); const settings = app.fixtures.get(platform)!.settings;
    await driver.open(settings.productUrl);
    assert.equal(await driver.configure(settings, new AbortController().signal), true);
    assert.ok(await driver.addButton(settings), "fixture must expose the purchase control");
    app.runner.start(true); await until(() => app.runner.state.phase === "completed", app.runner);
    assert.equal(app.fixtures.get(platform)!.counts.entry, 1); assert.equal(app.fixtures.get(platform)!.counts.submit, 1);
    assert.equal(app.runner.state.submission?.platform, platform);
  } finally { await app.close(); }
});

test("simultaneous availability in four marketplaces grants exactly one purchase and one submission", async () => {
  const app = await setup(["jd", "taobao", "tmall", "douyin"]);
  try { app.runner.start(true); await until(() => app.runner.state.phase === "completed", app.runner);
    const counts = [...app.fixtures.values()].map((item) => item.counts);
    assert.equal(counts.reduce((n, count) => n + count.entry, 0), 1);
    assert.equal(counts.reduce((n, count) => n + count.submit, 0), 1);
    for (const platform of app.runner.state.runPlatforms) if (platform !== app.runner.state.winner) assert.equal(app.runner.state.channels[platform].phase, "stopped");
  } finally { await app.close(); }
});

test("a challenged marketplace can pause while another channel completes", async () => {
  const app = await setup(["jd", "tmall"], { jd: { challenge: true } });
  try { app.runner.start(true); await until(() => app.runner.state.phase === "completed", app.runner);
    assert.equal(app.runner.state.winner, "tmall"); assert.equal(app.fixtures.get("jd")!.counts.entry, 0);
  } finally { await app.close(); }
});

for (const [name, options] of [["wrong product ID", { wrongId: true }], ["additional item", { duplicate: true }], ["deposit conditions", { deposit: true }]] as [string, Options][]) test(`marketplace pauses instead of submitting on ${name}`, async () => {
  const app = await setup(["jd"], { jd: options });
  try { app.runner.start(true); await until(() => app.runner.state.phase === "awaiting_user", app.runner); assert.equal(app.fixtures.get("jd")!.counts.submit, 0); }
  finally { await app.close(); }
});

test("an uncertain submission locks every platform after restart", async () => {
  const app = await setup(["jd", "tmall"], { jd: { uncertain: true }, tmall: { slow: true } });
  try { app.runner.start(true); await until(() => app.runner.state.phase === "awaiting_user" && !!app.runner.state.submission, app.runner);
    assert.equal(app.runner.state.winner, "jd"); assert.equal(app.fixtures.get("jd")!.counts.submit, 1); assert.equal(app.fixtures.get("tmall")!.counts.entry, 0);
    await app.runner.stop(); const config = app.fixtures.get("tmall")!.settings;
    const restarted = new TaskRunner(config, [], await readSubmission());
    assert.throws(() => restarted.start(true), /提交记录/);
  } finally { await app.close(); }
});

test("incomplete channel settings block start before any browser opens", async () => {
  const app = await setup(["jd", "tmall"]);
  try { app.runner.state.workspace.plans.tmall.productUrl = ""; assert.throws(() => app.runner.start(true), /天猫/); assert.equal(app.fixtures.get("jd")!.counts.product, 0); }
  finally { await app.close(); }
});

test("a channel retains the primary until refresh is due and verifies its backup listing ID", async () => {
  const app = await setup(["jd"], { jd: { soldOutPrimary: true } });
  try {
    const plan = app.runner.state.workspace.plans.jd;
    plan.backupProductUrl = targets.jd.product.replace(targets.jd.id, "222333444");
    app.runner.start(true);
    await until(() => !!app.runner.state.channels.jd.nextCheckAt, app.runner);
    assert.equal(app.fixtures.get('jd')!.counts.product, 1);
    app.runner.getBrowser('jd').lastNavigationAt = Date.now() - 31_000;
    await until(() => app.runner.state.phase === "completed", app.runner);
    assert.equal(app.fixtures.get("jd")!.counts.entry, 1);
    assert.ok(app.fixtures.get("jd")!.visited.includes(plan.backupProductUrl));
    assert.equal(app.runner.state.submission?.productUrl, plan.backupProductUrl);
  } finally { await app.close(); }
});

test('DOM availability changes are picked up without reloading the product page', async () => {
  const app = await setup(['jd'], { jd: { unavailable: true } });
  try {
    app.runner.start(true);
    await until(() => app.runner.state.channels.jd.attempt >= 2 && !!app.runner.state.channels.jd.nextCheckAt, app.runner);
    const item = app.fixtures.get('jd')!;
    assert.equal(item.counts.product, 1);
    const page = await app.runner.getBrowser('jd').getPage();
    await page.evaluate((checkout) => {
      const button = document.createElement('button'); button.textContent = '立即购买';
      button.onclick = () => { location.href = checkout; };
      document.querySelector('main')!.append(button);
    }, targets.jd.checkout);
    await until(() => app.runner.state.phase === 'completed', app.runner);
    assert.equal(item.counts.product, 1);
    assert.equal(item.counts.entry, 1);
  } finally { await app.close(); }
});

test('the same Tmall listing configured in Taobao opens only the Tmall execution worker', async () => {
  const app = await setup(['taobao', 'tmall']);
  try {
    app.runner.state.workspace.plans.taobao.productUrl = targets.tmall.product;
    app.runner.start(true); await until(() => app.runner.state.phase === 'completed', app.runner);
    assert.equal(app.runner.state.winner, 'tmall');
    assert.equal(app.runner.state.channels.taobao.mergedInto, 'tmall');
    assert.equal(app.runner.state.channels.taobao.phase, 'merged');
    assert.equal(app.fixtures.get('taobao')!.counts.product, 0);
    assert.equal(app.fixtures.get('tmall')!.counts.entry, 1);
  } finally { await app.close(); }
});

test('reaching launch time does not shorten network-error backoff', async () => {
  const app = await setup(['jd'], { jd: { networkFailure: true } });
  try {
    // Chrome can retry an aborted document internally. Count the application's
    // navigation calls so the assertion measures the scheduler's own retries.
    const driver = app.runner.getBrowser('jd'); const open = driver.open.bind(driver);
    let navigations = 0;
    driver.open = async (...args) => { navigations++; return open(...args); };
    app.runner.state.workspace.plans.jd.launchAt = new Date(Date.now() + 2000).toISOString();
    app.runner.start(false);
    await until(() => !!app.runner.state.channels.jd.nextCheckAt, app.runner);
    assert.ok(Date.parse(app.runner.state.channels.jd.nextCheckAt!) - Date.now() > 28_000);
    await delay(2500);
    assert.equal(navigations, 1);
    assert.equal(app.fixtures.get('jd')!.counts.entry, 0);
  } finally { await app.close(); }
});

test('a longer DOM polling interval does not postpone a configured page refresh', async () => {
  const app = await setup(['jd'], { jd: { unavailable: true } });
  try {
    Object.assign(app.runner.state.workspace.plans.jd, { pollSeconds: 60, launchRefreshSeconds: 15 });
    app.runner.start(true);
    await until(() => !!app.runner.state.channels.jd.nextCheckAt, app.runner);
    const channel = app.runner.state.channels.jd;
    assert.ok(Date.parse(channel.nextCheckAt!) - Date.now() <= 15_000);
    assert.ok(Date.parse(channel.nextCheckAt!) <= Date.parse(channel.nextRefreshAt!));
    assert.equal(app.fixtures.get('jd')!.counts.product, 1);
  } finally { await app.close(); }
});

test('429 blocks inspection, early resume and task restart without making another product request', async () => {
  const app = await setup(['jd'], { jd: { restrictedStatus: 429, retryAfter: '60' } });
  try {
    app.runner.start(true); await until(() => app.runner.state.phase === 'cooldown', app.runner);
    assert.equal(app.fixtures.get('jd')!.counts.entry, 0);
    assert.equal(app.fixtures.get('jd')!.counts.product, 1);
    assert.throws(() => app.runner.resume('jd'));
    await app.runner.stop();
    await assert.rejects(() => app.runner.inspect(), /429/);
    await assert.rejects(() => app.runner.reviewAccess('jd'), /冷却/);
    app.runner.start(true); await until(() => app.runner.state.phase === 'cooldown', app.runner);
    assert.equal(app.fixtures.get('jd')!.counts.product, 1);
  } finally { await app.close(); }
});

test('Retry-After expiry waits for explicit review, then reads the existing page before navigation', async () => {
  const app = await setup(['jd'], { jd: { restrictedStatus: 429, retryAfter: '1' } });
  try {
    app.runner.start(true); await until(() => app.runner.state.phase === 'awaiting_user', app.runner);
    assert.equal(app.fixtures.get('jd')!.counts.product, 1);
    assert.equal(app.fixtures.get('jd')!.counts.entry, 0);
    app.runner.resume('jd'); await until(() => app.runner.state.phase === 'completed', app.runner);
    assert.equal(app.fixtures.get('jd')!.counts.product, 1);
    assert.equal(app.fixtures.get('jd')!.counts.submit, 1);
  } finally { await app.close(); }
});

test("stopping a scheduled race prevents purchase in every channel", async () => {
  const app = await setup(["jd", "tmall"]);
  try {
    for (const platform of app.runner.state.workspace.enabledPlatforms) app.runner.state.workspace.plans[platform].launchAt = new Date(Date.now() + 60000).toISOString();
    app.runner.start(false); await delay(600); await app.runner.stop();
    assert.equal(app.runner.state.phase, "stopped");
    for (const item of app.fixtures.values()) assert.equal(item.counts.entry + item.counts.submit, 0);
  } finally { await app.close(); }
});

test("closing a login popup returns to the original page without cancelling a scheduled task", async () => {
  const app = await setup(["jd"]);
  try {
    app.runner.state.workspace.plans.jd.launchAt = new Date(Date.now() + 60000).toISOString();
    const driver = app.runner.getBrowser("jd");
    app.runner.start(false); await delay(650);
    const original = await driver.getPage();
    const popup = await app.fixtures.get("jd")!.context.newPage();
    assert.equal(driver.page, popup);
    await popup.close();
    assert.equal(await driver.getPage(), original);
    assert.equal(app.runner.active, true);
    assert.equal(app.fixtures.get("jd")!.counts.entry, 0);
  } finally { await app.close(); }
});
