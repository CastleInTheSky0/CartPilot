import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser, type BrowserContext } from "playwright";
import {
  DEFAULT_SETTINGS,
  defaultWorkspace,
  type Settings,
  type Phase,
} from "../shared/types.ts";

// All Apple requests are fulfilled locally. These tests never reach a live store.
process.env.DUO_DATA_DIR = path.resolve("output", "tests", randomUUID());
const { initStore, readSubmission } = await import("../server/store.ts");
const { TaskRunner } = await import("../server/runner.ts");
const { AppleBrowser } = await import("../server/browser.ts");
const { AccessGuard } = await import("../server/access.ts");
let browser: Browser;
before(async () => {
  await initStore();
  browser = await chromium.launch({ headless: true, channel: "chromium" });
});
after(async () => {
  await browser?.close();
});

function document(main: string) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>隔离测试商店</title><style>label,button{display:block;padding:10px}input{margin:10px}</style></head><body><main>${main}</main></body></html>`;
}
type FixtureOptions = {
  quantity?: number;
  total?: string;
  extraItem?: boolean;
  ambiguousSubmit?: boolean;
  restrictedStatus?: number;
};

async function setup(
  options: FixtureOptions = {},
  settings: Partial<Settings> = {},
) {
  const context = await browser.newContext({
    locale: "zh-CN",
    reducedMotion: "reduce",
  });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "www.apple.com.cn") {
      await route.abort();
      return;
    }
    const item = `<section data-autom="bag-item"><h2>iPhone Duo 256GB 星光白色</h2><span>数量：${options.quantity ?? 1}</span></section>${options.extraItem ? '<section data-autom="bag-item">其他商品 数量：1</section>' : ""}`;
    const total = `<div data-autom="order-total">${options.total ?? "RMB 15,999"}</div>`;
    let html: string;
    if (url.pathname.startsWith("/shop/buy-iphone/"))
      html = document(
        `<h1>iPhone Duo</h1><input type="radio" id="color" name="color"><label for="color">星光白色</label><input type="radio" id="capacity" name="capacity"><label for="capacity">256GB</label><button data-autom="add-to-cart" onclick="localStorage.setItem('added',String(+(localStorage.getItem('added')||0)+1));localStorage.setItem('bag','yes');location.href='/shop/bag'">加入购物袋</button>`,
      );
    else if (url.pathname === "/shop/bag")
      html = document(
        `<script>if(!localStorage.getItem('bag'))document.write('<h1>你的购物袋中没有商品。</h1>');else document.write(${JSON.stringify(item + total + '<button data-autom="bag-checkout-button" onclick="location.href=\'/shop/checkout/review\'">结账</button>')})</script>`,
      );
    else if (url.pathname === "/shop/checkout/thankyou")
      html = document("<h1>谢谢你的订购</h1><p>订单号 W-TEST-ONLY</p>");
    else if (url.pathname === "/shop/checkout/review")
      html = document(
        `${item}${total}<button data-autom="place-order" onclick="localStorage.setItem('submitted',String(+(localStorage.getItem('submitted')||0)+1));${options.ambiguousSubmit ? "this.textContent='正在处理';this.disabled=true" : "location.href='/shop/checkout/thankyou'"}">提交订单</button>`,
      );
    else html = document("<h1>未知页面</h1>");
    await route.fulfill({
      status: url.pathname === '/shop/bag' ? options.restrictedStatus ?? 200 : 200,
      contentType: "text/html; charset=utf-8",
      body: html,
    });
  });
  const page = await context.newPage();
  const driver = new AppleBrowser(() => {});
  driver.context = context;
  await driver.getPage();
  const config = structuredClone({
    ...DEFAULT_SETTINGS,
    autoSubmit: true,
    ...settings,
  });
  const runner = new TaskRunner(config, [], null, defaultWorkspace(config), undefined, new AccessGuard({ globalGapMs: 0, familyGapMs: 0 }));
  runner.browser = driver;
  return { context, page, runner };
}

async function waitPhase(
  runner: InstanceType<typeof TaskRunner>,
  phase: Phase,
) {
  const deadline = Date.now() + 12000;
  while (runner.state.phase !== phase) {
    if (Date.now() > deadline || runner.state.phase === "error")
      throw new Error(
        `等待 ${phase} 失败：${runner.state.phase} ${runner.state.message}`,
      );
    await delay(25);
  }
}

async function close(
  runner: InstanceType<typeof TaskRunner>,
  context: BrowserContext,
) {
  await runner.stop();
  await context.close();
}

test("full isolated purchase flow selects the variant and submits once", async () => {
  const { context, page, runner } = await setup();
  try {
    runner.start(true);
    await waitPhase(runner, "completed");
    assert.equal(await page.evaluate(() => localStorage.getItem("added")), "1");
    assert.equal(
      await page.evaluate(() => localStorage.getItem("submitted")),
      "1",
    );
    assert.equal(runner.state.submission?.result, "confirmed");
    await delay(10);
    assert.throws(() => runner.start(true), /提交记录/);
  } finally {
    await close(runner, context);
  }
});

test("manual mode reaches review without submitting", async () => {
  const { context, page, runner } = await setup({}, { autoSubmit: false });
  try {
    runner.start(true);
    await waitPhase(runner, "ready");
    assert.equal(
      await page.evaluate(() => localStorage.getItem("submitted")),
      null,
    );
    assert.throws(() => runner.start(true), /已有任务/);
    await page.getByRole("button", { name: "提交订单" }).click();
    runner.resume();
    await waitPhase(runner, "completed");
  } finally {
    await close(runner, context);
  }
});

for (const [name, options] of [
  ["quantity is two", { quantity: 2 }],
  ["an extra item is present", { extraItem: true }],
  ["price exceeds the budget", { total: "RMB 16,000" }],
  ["total is ambiguous", { total: "RMB 15,999 或 RMB 667" }],
] as [string, FixtureOptions][])
  test(`does not proceed when ${name}`, async () => {
    const { context, page, runner } = await setup(options);
    try {
      runner.start(true);
      await waitPhase(runner, "awaiting_user");
      assert.equal(
        await page.evaluate(() => localStorage.getItem("submitted")),
        null,
      );
      assert.equal(new URL(page.url()).pathname, "/shop/bag");
    } finally {
      await close(runner, context);
    }
  });

test("uncertain submission persists a retry lock across runner restarts", async () => {
  const { context, page, runner } = await setup({ ambiguousSubmit: true });
  try {
    runner.start(true);
    await waitPhase(runner, "awaiting_user");
    assert.equal(
      await page.evaluate(() => localStorage.getItem("submitted")),
      "1",
    );
    assert.equal(runner.state.submission?.result, "unknown");
    runner.resume();
    await delay(100);
    await waitPhase(runner, "awaiting_user");
    assert.equal(
      await page.evaluate(() => localStorage.getItem("submitted")),
      "1",
    );
    const restarted = new TaskRunner(
      DEFAULT_SETTINGS,
      [],
      await readSubmission(),
    );
    assert.throws(() => restarted.start(true), /提交记录/);
  } finally {
    await close(runner, context);
  }
});

test("stopping a scheduled task cancels it before any cart mutation", async () => {
  const { context, page, runner } = await setup(
    {},
    { launchAt: new Date(Date.now() + 60000).toISOString() },
  );
  try {
    runner.start(false);
    await delay(650);
    await runner.stop();
    assert.equal(runner.state.phase, "stopped");
    assert.equal(
      await page.evaluate(() => localStorage.getItem("added")),
      null,
    );
  } finally {
    await close(runner, context);
  }
});

test('access restrictions pause the task before cart changes', async () => {
  const { context, page, runner } = await setup({ restrictedStatus: 541 });
  try {
    runner.start(true);
    await waitPhase(runner, 'cooldown');
    assert.match(runner.state.message, /541/);
    assert.equal(await page.evaluate(() => localStorage.getItem('added')), null);
  } finally { await close(runner, context); }
});

test('scheduled Apple task preselects the configuration but waits for launch before adding', async () => {
  const { context, page, runner } = await setup({}, { launchAt: new Date(Date.now() + 5000).toISOString() });
  try {
    runner.start(false);
    const deadline = Date.now() + 4000;
    while (!(await page.locator('#capacity').isChecked().catch(() => false))) {
      if (Date.now() > deadline) throw new Error('configuration was not preloaded');
      await delay(25);
    }
    assert.equal(await page.evaluate(() => localStorage.getItem('added')), null);
    await waitPhase(runner, 'completed');
    assert.equal(await page.evaluate(() => localStorage.getItem('added')), '1');
  } finally { await close(runner, context); }
});

test('required radio groups accept a selected alternative but incomplete fields pause', async () => {
  const { context, page, runner } = await setup();
  try {
    await page.goto(DEFAULT_SETTINGS.productUrl);
    await page.setContent(document('<input type="radio" name="shipping" required checked value="free"><input type="radio" name="shipping" required value="paid"><input type="text" required value="saved">'));
    assert.equal(await runner.browser.hasEmptyRequiredFields(), false);
    await page.locator('input[type="text"]').fill('');
    assert.equal(await runner.browser.hasEmptyRequiredFields(), true);
  } finally { await close(runner, context); }
});

test('third-party payment pages require manual handoff', async () => {
  const { context, page, runner } = await setup();
  try {
    await context.route('https://payment.example/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: document('<h1>测试付款</h1>') }));
    await page.goto('https://payment.example/');
    assert.match((await runner.browser.intervention())!, /Apple 以外/);
  } finally { await close(runner, context); }
});

test('conflicting quantity controls cannot be overridden by a quantity text label', async () => {
  const { context, page, runner } = await setup();
  try {
    await page.goto('https://www.apple.com.cn/shop/bag');
    await page.setContent(document('<section data-autom="bag-item">iPhone Duo 256GB 星光白色 数量：1<input type="number" value="1"><input type="number" value="2"></section><div data-autom="order-total">RMB 15,999</div>'));
    const evidence = await runner.browser.readOrder(DEFAULT_SETTINGS);
    assert.equal(evidence.items[0].quantity, null);
  } finally { await close(runner, context); }
});
