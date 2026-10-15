import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser } from "playwright";
import { defaultPlan, defaultWorkspace, type BrowserConnectionConfig } from "../shared/types.ts";
import { ExtensionConnection, validBridgeEndpoint, type ExtensionConnector } from "../server/extension.ts";

process.env.DUO_DATA_DIR = path.resolve("output", "tests", randomUUID());
const { initStore, validateBrowserConnection, readBrowserConnection, writeJson } = await import("../server/store.ts");
const { TaskRunner } = await import("../server/runner.ts");
const { createBrowser } = await import("../server/marketplace.ts");
const { AccessGuard } = await import("../server/access.ts");
const extensionConfig: BrowserConnectionConfig = { version: 1, mode: "extension", profileDirectory: null };
let native: Browser;
let endpoint: string;

before(async () => {
  await initStore();
  native = await chromium.launch({ headless: true, channel: "chromium" });
  // Exercise the same Browser.bind -> chromium.connect handoff used by the
  // official extension host, with all web content supplied by local fixtures.
  endpoint = (await native.bind("Duo offline extension fixture", { workspaceDir: process.env.DUO_DATA_DIR })).endpoint;
});
after(async () => { await native?.unbind(); await native?.close(); });
const connector: ExtensionConnector = async (_profile, signal) => {
  signal.throwIfAborted();
  const browser = await chromium.connect(endpoint);
  return { browser, dispose: () => browser.close() };
};

async function fixture() {
  const context = await native.newContext();
  const requests: string[] = [];
  await context.route("**/*", async (route) => {
    requests.push(route.request().url());
    await route.fulfill({ contentType: "text/html; charset=utf-8", body: '<!doctype html><html><head><meta charset="utf-8"><title>PRIVATE_ACCOUNT_NAME</title></head><body><div id="ttbar-login"><a class="nickname">PRIVATE_ACCOUNT_NAME</a></div><h1>iPhone Duo</h1></body></html>' });
  });
  const page = await context.newPage();
  await page.goto("https://item.jd.com/123456789.html?tracking=PRIVATE_TOKEN");
  return { context, page, requests };
}
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("fixture event timed out"); await delay(20); }
}

test("bridge endpoint validation only accepts local browser sockets and loopback WebSocket connections", () => {
  assert.ok(validBridgeEndpoint(endpoint));
  assert.ok(validBridgeEndpoint("ws://127.0.0.1:4318/random-path"));
  assert.ok(validBridgeEndpoint("ws://[::1]:4318/random-path"));
  for (const url of ["ws://example.com:4318/", "ws://localhost.example.com:4318/", "http://localhost:4318/", "ws://user:secret@localhost:4318/", "file:///test", "\\\\.\\pipe\\other", endpoint + "/../other", null]) assert.equal(validBridgeEndpoint(url), false);
});

test("browser configuration defaults to extension mode and rejects arbitrary profile paths", async () => {
  assert.deepEqual(await readBrowserConnection(), extensionConfig);
  for (const mode of ["extension", "managed"]) {
    for (const profileDirectory of [null, "Default", "Profile 1"]) assert.equal(validateBrowserConnection({ version: 1, mode, profileDirectory }).mode, mode);
  }
  for (const profileDirectory of ["../Default", "C:\\Users\\Profile", "--user-data-dir=other", "Profile 1 --flag", ""]) assert.throws(() => validateBrowserConnection({ ...extensionConfig, profileDirectory }));
  assert.throws(() => validateBrowserConnection({ ...extensionConfig, mode: "unknown" }));
  await writeJson("browser-connection.json", extensionConfig);
  assert.deepEqual(await readBrowserConnection(), extensionConfig);
});

test("only platform tabs are listed; tracking data, page titles and unrelated content stay out of UI", async () => {
  const app = await fixture();
  const connection = new ExtensionConnection(() => {}, connector);
  try {
    const unrelated = await app.context.newPage(); await unrelated.goto("https://example.com/private");
    connection.begin(null); await connection.settled();
    assert.equal(connection.state.phase, "connected");
    const tabs = await connection.list("jd");
    assert.equal(tabs.length, 1);
    assert.equal(tabs[0].url, "https://item.jd.com/123456789.html");
    assert.ok(!JSON.stringify(tabs).includes("PRIVATE"));
    assert.equal((await connection.list("apple")).length, 0);
    assert.throws(() => connection.resolve("apple", tabs[0].id));
    assert.throws(() => connection.resolve("jd", randomUUID()));
    const count = app.requests.length;
    for (let attempt = 0; attempt < 3; attempt++) await connection.list("jd");
    assert.equal(app.requests.length, count);
    await connection.disconnect();
    assert.ok(!app.page.isClosed()); assert.ok(!unrelated.isClosed()); assert.ok(native.isConnected());
  } finally { await connection.disconnect(); await app.context.close(); }
});

test("extension driver reuses an existing session and never adopts unrelated new tabs", { timeout: 20000 }, async () => {
  const app = await fixture();
  const connection = new ExtensionConnection(() => {}, connector);
  const driver = createBrowser("jd", () => {}); driver.mode = "extension";
  try {
    await assert.rejects(() => driver.getPage(), /请先连接普通浏览器扩展/);
    assert.equal(driver.context, null);
    connection.begin(null); await connection.settled();
    const [tab] = await connection.list("jd");
    const selected = connection.resolve("jd", tab.id);
    await driver.attachExtensionPage(selected);
    const count = app.requests.length;
    assert.equal((await driver.checkLogin()).state, "logged_in");
    assert.equal(app.requests.length, count);
    const unrelated = await app.context.newPage(); await unrelated.goto("https://item.jd.com/987654321.html");
    await delay(50);
    assert.equal(driver.page, selected);
    const popupEvent = app.context.waitForEvent("page");
    await app.page.evaluate(() => { window.open("https://passport.jd.com/new/login.aspx"); });
    const popup = await popupEvent;
    await until(() => driver.page?.url().includes("passport.jd.com") ?? false);
    await popup.close();
    await until(() => driver.page === selected);
    await driver.close();
    assert.ok(!app.page.isClosed()); assert.ok(!unrelated.isClosed());
    await driver.attachExtensionPage(selected);
    await app.page.close();
    await until(() => !driver.isOpen);
    assert.equal(driver.page, null, "closing the selected tab must never fall back to an unrelated tab");
    await assert.rejects(() => driver.getPage(), /接入京东/);
  } finally { await driver.close(); await connection.disconnect(); await app.context.close(); }
});

test("runner requires a connected, explicitly bound tab and preserves the native browser on disconnect", async () => {
  const app = await fixture();
  const settings = { ...defaultPlan("jd"), productUrl: "https://item.jd.com/123456789.html" };
  const runner = new TaskRunner(settings, [], null, defaultWorkspace(settings), undefined, new AccessGuard({ globalGapMs: 0, familyGapMs: 0 }), extensionConfig, connector);
  try {
    assert.throws(() => runner.start(true), /请先连接普通浏览器扩展/);
    runner.connectExtension(); await runner.extension.settled();
    assert.throws(() => runner.start(true), /请先接入京东/);
    const [tab] = await runner.extension.list("jd");
    await runner.bindExtensionTab("jd", tab.id);
    await runner.refreshLogin("jd");
    assert.ok(runner.state.channels.jd.browserOpen);
    assert.equal(runner.state.channels.jd.login.state, "logged_in");
    assert.equal(runner.state.channels.jd.extensionTab?.id, tab.id);
    assert.equal(runner.state.browserName, "Chrome · 普通浏览器扩展");
    runner.access.blockHttp("jd", 403);
    const cooldown = runner.state.channels.jd.cooldownUntil;
    assert.ok(cooldown);
    await runner.configureBrowser({ ...extensionConfig, mode: "managed" });
    assert.equal(runner.state.channels.jd.cooldownUntil, cooldown, "switching browser mode cannot clear access restrictions");
    assert.ok(!app.page.isClosed());
    await runner.configureBrowser(extensionConfig);
    await runner.disconnectExtension();
    assert.equal(runner.state.channels.jd.browserOpen, false);
    assert.equal(runner.state.channels.jd.login.state, "unknown");
    assert.equal(runner.state.channels.jd.extensionTab, null);
    assert.ok(!app.page.isClosed());
  } finally { await runner.closeBrowsers(); await app.context.close(); }
});

test("rebinding during a login read immediately reports the new selected session", { timeout: 20000 }, async () => {
  const app = await fixture();
  const guest = await app.context.newPage(); await guest.goto("https://item.jd.com/987654321.html");
  await guest.locator("body").evaluate((body) => { body.innerHTML = '<div id="ttbar-login"><a class="link-login">你好，请登录</a></div>'; });
  const settings = defaultPlan("jd");
  const runner = new TaskRunner(settings, [], null, defaultWorkspace(settings), undefined, new AccessGuard(), extensionConfig, connector);
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let reads = 0;
  try {
    runner.connectExtension(); await runner.extension.settled();
    const tabs = await runner.extension.list("jd");
    const firstTab = tabs.find((tab) => tab.url.includes("123456789.html"))!;
    const guestTab = tabs.find((tab) => tab.url.includes("987654321.html"))!;
    const driver = runner.getBrowser("jd");
    const originalRead = driver.checkLogin.bind(driver);
    driver.checkLogin = async () => {
      const status = await originalRead();
      if (++reads === 1) await gate;
      return status;
    };
    const firstBind = runner.bindExtensionTab("jd", firstTab.id);
    await until(() => reads === 1);
    const secondBind = runner.bindExtensionTab("jd", guestTab.id);
    await until(() => driver.page?.url().includes("987654321.html") ?? false);
    release();
    await Promise.all([firstBind, secondBind]);
    assert.equal(runner.state.channels.jd.extensionTab?.id, guestTab.id);
    assert.equal(runner.state.channels.jd.login.state, "logged_out");
    assert.ok(reads >= 2);
  } finally { release(); await runner.closeBrowsers(); await app.context.close(); }
});

test("one tab cannot be assigned to both Taobao and Tmall", async () => {
  const app = await fixture();
  await app.page.goto("https://detail.tmall.com/item.htm?id=123456789");
  const settings = defaultPlan("tmall");
  const runner = new TaskRunner(settings, [], null, defaultWorkspace(settings), undefined, new AccessGuard(), extensionConfig, connector);
  try {
    runner.connectExtension(); await runner.extension.settled();
    const [tab] = await runner.extension.list("tmall");
    await runner.bindExtensionTab("tmall", tab.id);
    await assert.rejects(() => runner.bindExtensionTab("taobao", tab.id), /已接入其他渠道/);
    const popupEvent = app.context.waitForEvent("page", { timeout: 5000 });
    await app.page.evaluate(() => { window.open("https://login.tmall.com/"); });
    await popupEvent;
    await until(() => runner.getBrowser("tmall").page?.url().includes("login.tmall.com") ?? false);
    await assert.rejects(() => runner.bindExtensionTab("taobao", tab.id), /已接入其他渠道/, "an authorized root tab stays owned while a login popup is active");
  } finally { await runner.closeBrowsers(); await app.context.close(); }
});

test("cancellation and timeouts release pending connection attempts without resurrecting an old session", async () => {
  let attempts = 0;
  const waiting: ExtensionConnector = (_profile, signal) => new Promise((_resolve, reject) => {
    attempts++;
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  const connection = new ExtensionConnection(() => {}, waiting, 60);
  connection.begin(null);
  await connection.disconnect();
  assert.equal(connection.state.phase, "disconnected");
  connection.begin(null); await connection.settled();
  assert.equal(connection.state.phase, "error");
  assert.match(connection.state.message, /超时/);
  assert.equal(attempts, 2);
  await connection.disconnect();
});

test("disconnection invalidates selected tab IDs and does not close native web pages", async () => {
  const app = await fixture();
  let remote: Browser | null = null;
  const connection = new ExtensionConnection(() => {}, async (_profile, signal) => {
    const session = await connector(null, signal); remote = session.browser; return session;
  });
  try {
    connection.begin(null); await connection.settled();
    const [tab] = await connection.list("jd");
    await (remote as unknown as Browser).close();
    await until(() => connection.state.phase === "disconnected");
    assert.throws(() => connection.resolve("jd", tab.id), /断开/);
    assert.ok(!app.page.isClosed());
    connection.begin(null); await connection.settled();
    assert.throws(() => connection.resolve("jd", tab.id), /关闭或不属于/);
  } finally { await connection.disconnect(); await app.context.close(); }
});

test("extension checkout still validates the order and submits exactly once in an offline page", async () => {
  const context = await native.newContext();
  const counts = { product: 0, submit: 0 };
  const product = "https://item.jd.com/100414360202.html";
  const checkout = "https://trade.jd.com/shopping/order/getOrderInfo.action";
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    let body: string;
    if (url.startsWith(product)) {
      counts.product++;
      body = `<div class="sku-title-name">Apple iPhone Duo 256GB 星光白色</div><div class="specification-item-sku specification-item-sku--selected">星光白色</div><div class="specification-item-sku specification-item-sku--selected">256GB</div><div class="bottom-btns-root"><div class="first-row" onclick="location.href='${checkout}'">立即抢购</div></div>`;
    } else if (url === checkout) {
      body = `<div class="goods-list"><div class="goods-item" data-sku="100414360202"><a href="${product}">iPhone Duo 256GB 星光白色</a><span class="p-num">1</span></div></div><span id="sumPayPriceId">¥15,999.00</span><button id="order-submit" onclick="fetch('/submitted',{method:'POST'}).then(()=>location.href='https://success.jd.com/success/success.action')">提交订单</button>`;
    } else if (new URL(url).pathname === "/submitted") { counts.submit++; body = "ok"; }
    else body = "<h1>订单提交成功</h1><p>订单号：OFFLINE123456789</p>";
    await route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><meta charset="utf-8"><style>button{padding:10px}</style><main>${body}</main>` });
  });
  const page = await context.newPage(); await page.goto(product);
  const settings = { ...defaultPlan("jd"), productUrl: product, autoSubmit: true };
  const runner = new TaskRunner(settings, [], null, defaultWorkspace(settings), undefined, new AccessGuard({ globalGapMs: 0, familyGapMs: 0 }), extensionConfig, connector);
  try {
    runner.connectExtension(); await runner.extension.settled();
    const [tab] = await runner.extension.list("jd"); await runner.bindExtensionTab("jd", tab.id);
    runner.start(true);
    const deadline = Date.now() + 15_000;
    while (runner.state.phase !== "completed") {
      if (Date.now() > deadline || runner.state.phase === "error") throw new Error(runner.state.message);
      await delay(20);
    }
    assert.equal(counts.submit, 1); assert.equal(counts.product, 1, "selected product tab must be reused");
    assert.equal(runner.state.submission?.result, "confirmed");
    assert.throws(() => runner.start(true), /存在一次订单提交记录/);
    await runner.disconnectExtension();
    assert.ok(!page.isClosed());
  } finally { await runner.stop(); await runner.closeBrowsers(); await context.close(); }
});
