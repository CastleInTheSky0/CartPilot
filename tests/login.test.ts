import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chromium, type Browser } from "playwright";
import { PLATFORMS, defaultPlan, defaultWorkspace, LOGIN_STATUS_TTL, type Platform } from "../shared/types.ts";
import { loginDisplay } from "../shared/login.ts";
import { readLoginStatus, unknownLogin } from "../server/login.ts";

process.env.DUO_DATA_DIR = path.resolve("output", "tests", randomUUID());
const { TaskRunner } = await import("../server/runner.ts");
const { createBrowser } = await import("../server/marketplace.ts");

let browser: Browser;
before(async () => { browser = await chromium.launch({ channel: "chromium", headless: true }); });
after(async () => { await browser?.close(); });
const urls: Record<Platform, string> = {
  apple: "https://www.apple.com.cn/shop/account/home",
  jd: "https://item.jd.com/123456789.html",
  taobao: "https://item.taobao.com/item.htm?id=123456789",
  tmall: "https://detail.tmall.com/item.htm?id=123456789",
  douyin: "https://www.douyin.com/shopping/product/123456789",
};
const accounts: Record<Platform, string> = {
  apple: '<button data-autom="signOut">退出登录</button>',
  jd: '<div id="ttbar-login"><a class="nickname">PRIVATE_FIXTURE_NAME</a></div>',
  taobao: '<div id="J_SiteNavLogin"><a class="site-nav-login-info-nick">PRIVATE_FIXTURE_NAME</a></div>',
  tmall: '<div id="sn-login-info"><a class="sn-user-nick">PRIVATE_FIXTURE_NAME</a></div>',
  douyin: '<div data-e2e="user-info"><span data-e2e="user-nickname">PRIVATE_FIXTURE_NAME</span></div>',
};

async function fixture(platform: Platform, html: string) {
  const context = await browser.newContext();
  const requests: string[] = [];
  await context.route("**/*", async (route) => {
    requests.push(route.request().url());
    const body = route.request().frame().parentFrame() ? '<p>Offline frame</p>' : html;
    await route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><html><head><meta charset="utf-8"></head><body>${body}</body></html>` });
  });
  const page = await context.newPage();
  await page.goto(urls[platform]);
  return { context, page, requests };
}

for (const platform of PLATFORMS) test(`${platform} reports explicit visible account evidence without exposing account information`, async () => {
  const app = await fixture(platform, accounts[platform]);
  try {
    const status = await readLoginStatus(app.page, platform);
    assert.equal(status.state, "logged_in");
    assert.equal(status.reason, "authenticated");
    assert.ok(status.checkedAt);
    assert.ok(!JSON.stringify(status).includes("PRIVATE_FIXTURE_NAME"));
  } finally { await app.context.close(); }
});

test("JD's current product header recognizes visible login evidence and ignores hidden or unrelated nicknames", async () => {
  // Structure observed in the user's connected JD product tab; account text is
  // replaced with a fixture value and no real page or session is saved.
  const account = '<li id="ttbar-login-2024" class="shortcut_btn fore1 dropdown shortcut_userico2"><div class="dt cw-icon"><i class="shortcut_userico_ico"></i><a class="nickname">PRIVATE_FIXTURE_NAME</a></div><div class="dd dropdown-layer" hidden><a>退出登录</a></div></li>';
  const app = await fixture("jd", `<ul>${account}</ul>`);
  try {
    const count = app.requests.length;
    for (let i = 0; i < 3; i++) {
      const status = await readLoginStatus(app.page, "jd");
      assert.equal(status.state, "logged_in");
      assert.equal(status.reason, "authenticated");
      assert.ok(!JSON.stringify(status).includes("PRIVATE_FIXTURE_NAME"));
    }
    await app.page.locator("body").evaluate((body, html) => {
      body.innerHTML = `<ul hidden>${html}</ul><section class="reviews"><a class="nickname">PRIVATE_REVIEWER</a></section>`;
    }, account);
    assert.equal((await readLoginStatus(app.page, "jd")).state, "unknown");
    await app.page.locator("body").evaluate((body) => {
      body.innerHTML = '<ul><li id="ttbar-login-2024"><a class="nickname" hidden>PRIVATE_FIXTURE_NAME</a><a class="link-login">你好，请登录</a></li></ul>';
    });
    assert.equal((await readLoginStatus(app.page, "jd")).state, "logged_out");
    await app.page.locator("body").evaluate((body) => {
      body.innerHTML = '<ul><li id="ttbar-login-2024"><a href="https://passport.jd.com/new/login.aspx">请登录</a></li></ul>';
    });
    assert.equal((await readLoginStatus(app.page, "jd")).state, "logged_out");
    await app.page.locator("body").evaluate((body) => {
      body.innerHTML = '<ul><li id="ttbar-login-2024"><a class="nickname">PRIVATE_FIXTURE_NAME</a><a class="link-login">请登录</a></li></ul>';
    });
    assert.equal((await readLoginStatus(app.page, "jd")).state, "unknown", "contradictory visible evidence must not be reported as logged in");
    await app.page.locator("body").evaluate((body, html) => { body.innerHTML = `<ul>${html}<a class="link-login">请登录</a></ul>`; }, account);
    assert.equal((await readLoginStatus(app.page, "jd")).state, "logged_in", "a guest link outside the header must not override the visible account");
    assert.equal(app.requests.length, count, "login checks must not refresh JD or request login endpoints");
  } finally { await app.context.close(); }
});

test("session cookies, a generic account link, hidden nicknames and contradictory controls do not establish login", async () => {
  const app = await fixture("jd", '<header><a href="/account">我的京东</a></header><div id="ttbar-login" style="display:none"><a class="nickname">PRIVATE_FIXTURE_NAME</a></div><main>商品详情</main>');
  try {
    await app.context.addCookies([{ name: "pt_key", value: "fixture-only", domain: ".jd.com", path: "/", secure: true }]);
    assert.equal((await readLoginStatus(app.page, "jd")).state, "unknown");
    await app.page.locator("body").evaluate((body, html) => { body.innerHTML = html; }, accounts.jd + '<header><a>请登录</a></header>');
    assert.equal((await readLoginStatus(app.page, "jd")).state, "unknown");
    await app.page.locator("body").evaluate((body) => { body.innerHTML = '<div id="ttbar-login"><a class="nickname" hidden>PRIVATE_FIXTURE_NAME</a><a class="link-login">你好，请登录</a></div>'; });
    assert.equal((await readLoginStatus(app.page, "jd")).state, "logged_out");
  } finally { await app.context.close(); }
});

test("login forms and expiry override a cached account header; verification remains uncertain", async () => {
  const app = await fixture("jd", accounts.jd);
  try {
    const checks: Array<[string, string, string]> = [
      ['<input type="password">', "logged_out", "login_required"],
      ['<p>登录已过期，请重新登录</p>', "logged_out", "login_required"],
      ['<p>安全验证：请拖动滑块</p>', "unknown", "verification"],
      ['<iframe title="验证码" src="https://captcha.jd.com/verify"></iframe>', "unknown", "verification"],
      ['<iframe title="登录" src="https://passport.jd.com/new/login.aspx"></iframe>', "logged_out", "login_required"],
    ];
    for (const [html, state, reason] of checks) {
      await app.page.locator("body").evaluate((body, markup) => { body.innerHTML = markup; }, accounts.jd + html);
      const status = await readLoginStatus(app.page, "jd");
      assert.equal(status.state, state); assert.equal(status.reason, reason);
    }
    await app.page.goto("https://passport.jd.com/new/login.aspx");
    assert.equal((await readLoginStatus(app.page, "jd")).state, "logged_out");
    await app.page.goto("https://example.com/");
    assert.equal((await readLoginStatus(app.page, "jd")).state, "unknown");
  } finally { await app.context.close(); }
});

test("rechecking reads the existing DOM without requests, navigation or logout clicks", async () => {
  const app = await fixture("jd", '<button onclick="fetch(\'/logout\')">退出登录</button>');
  try {
    const count = app.requests.length;
    for (let attempt = 0; attempt < 4; attempt++) assert.equal((await readLoginStatus(app.page, "jd")).state, "logged_in");
    assert.equal(app.requests.length, count);
    assert.equal(app.page.url(), urls.jd);
    await app.page.close();
    assert.equal((await readLoginStatus(app.page, "jd")).reason, "browser_closed");
    const driver = createBrowser("jd", () => {});
    assert.equal((await driver.checkLogin()).reason, "browser_closed");
    assert.equal(driver.context, null);
  } finally { await app.context.close(); }
});

test("each execution profile has separate state, page changes invalidate it, and old evidence expires", async () => {
  const tb = await fixture("taobao", accounts.taobao);
  const tm = await fixture("tmall", '<header><button>登录</button></header>');
  const settings = defaultPlan("taobao");
  let created = 0;
  const runner = new TaskRunner(settings, [], null, defaultWorkspace(settings), (platform, onChange) => {
    created++;
    const driver = createBrowser(platform, onChange);
    driver.context = platform === "taobao" ? tb.context : tm.context;
    return driver;
  });
  try {
    await runner.refreshLogin("jd");
    assert.equal(created, 0, "manual checks must not launch or create unopened sessions");
    for (const platform of ["taobao", "tmall"] as const) await runner.getBrowser(platform).getPage();
    await runner.refreshLogins();
    assert.equal(runner.state.channels.taobao.login.state, "logged_in");
    assert.equal(runner.state.channels.tmall.login.state, "logged_out");
    runner.state.channels.taobao.login.checkedAt = new Date(Date.now() - LOGIN_STATUS_TTL - 1000).toISOString();
    assert.equal(runner.snapshot().channels.taobao.login.reason, "stale");
    await runner.refreshLogin("taobao");
    await tb.page.goto("about:blank");
    assert.equal(runner.snapshot().channels.taobao.login.state, "unknown");
    await runner.refreshLogin("taobao");
    assert.equal(runner.state.channels.taobao.login.state, "unknown");
    await tm.page.close();
    assert.equal(runner.state.channels.tmall.login.reason, "browser_closed");
    assert.equal(runner.state.channels.tmall.browserOpen, false);
  } finally { await runner.closeBrowsers(); }
});

test("UI never shows fresh green login when disconnected, closed, expired or missing timestamps", () => {
  const runner = new TaskRunner(defaultPlan("jd"), [], null);
  const channel = runner.state.channels.jd;
  channel.browserOpen = true;
  channel.login = { state: "logged_in", reason: "authenticated", message: "fixture", checkedAt: new Date().toISOString() };
  assert.equal(loginDisplay(channel, true).label, "已登录");
  assert.equal(loginDisplay(channel, false).label, "暂无法确认");
  assert.equal(loginDisplay(channel, true, Date.now() + LOGIN_STATUS_TTL + 1000).label, "暂无法确认");
  channel.login.checkedAt = "invalid";
  assert.equal(loginDisplay(channel, true).label, "暂无法确认");
  channel.login.checkedAt = null;
  assert.equal(loginDisplay(channel, true).state, "unknown");
  channel.browserOpen = false;
  assert.equal(loginDisplay(channel, true).label, "未检测");
  assert.deepEqual(unknownLogin().checkedAt, null);
});
