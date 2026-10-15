import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import { ExtensionService } from "../../src/main/infrastructure/browser/extension-service.ts";
import type { ExtensionConnector } from "../../src/main/infrastructure/browser/official-connector.ts";

let native: Browser;
let connector: ExtensionConnector;
before(async () => {
  native = await chromium.launch({ headless: true, channel: "chromium" });
  const { endpoint } = await native.bind("CartPilot desktop offline fixture");
  connector = async (_profile, signal) => {
    signal.throwIfAborted();
    const browser = await chromium.connect(endpoint);
    return { browser, dispose: () => browser.close() };
  };
});
after(async () => {
  await native?.unbind();
  await native?.close();
});

test("桌面标签接入只读、隐藏跟踪信息，断开后保留浏览器页面并废弃旧标识", async () => {
  const context = await native.newContext();
  let requests = 0;
  await context.route("**/*", async (route) => {
    requests++;
    await route.fulfill({
      contentType: "text/html",
      body: '<title>PRIVATE_NAME</title><div id="ttbar-login"><a class="nickname">PRIVATE_NAME</a></div>',
    });
  });
  const page = await context.newPage();
  await page.goto("https://item.jd.com/123456789.html?token=PRIVATE_TOKEN");
  const service = new ExtensionService(connector, () => {});
  try {
    await service.execute({ type: "connect", input: { profileDirectory: null } });
    await service.connection.settled();
    const tabs = await service.execute({ type: "list", platform: "jd" });
    assert.equal(tabs.kind, "tabs");
    if (tabs.kind !== "tabs") throw new Error("expected tabs");
    const tab = tabs.value[0];
    assert.ok(tab);
    assert.equal(JSON.stringify(tabs).includes("PRIVATE"), false);
    await service.execute({ type: "bind", input: { platform: "jd", tabId: tab.id } });
    assert.equal(
      service.snapshot().channels.find((item) => item.platform === "jd")?.login.state,
      "logged_in",
    );
    assert.equal(requests, 1);
    await service.execute({ type: "disconnect" });
    assert.equal(page.isClosed(), false);
    assert.equal(native.isConnected(), true);
    assert.equal(
      service
        .snapshot()
        .channels.every((channel) => channel.tab === null && channel.login.state === "unknown"),
      true,
    );
    await service.execute({ type: "connect", input: { profileDirectory: null } });
    await service.connection.settled();
    await assert.rejects(() =>
      service.execute({ type: "bind", input: { platform: "jd", tabId: tab.id } }),
    );
  } finally {
    await service.dispose();
    await context.close();
  }
});

test("同一标签页不跨渠道争用，导航或关闭立即使接入失效", async () => {
  const context = await native.newContext();
  await context.route("**/*", (route) => route.fulfill({ body: "<main>Offline product</main>" }));
  const page = await context.newPage();
  await page.goto("https://detail.tmall.com/item.htm?id=123456789");
  const service = new ExtensionService(connector, () => {});
  try {
    await service.execute({ type: "connect", input: { profileDirectory: null } });
    await service.connection.settled();
    const tabs = await service.execute({ type: "list", platform: "tmall" });
    if (tabs.kind !== "tabs" || !tabs.value[0]) throw new Error("expected fixture tab");
    const tab = tabs.value[0];
    await service.execute({ type: "bind", input: { platform: "tmall", tabId: tab.id } });
    await assert.rejects(
      () => service.execute({ type: "bind", input: { platform: "taobao", tabId: tab.id } }),
      /已接入其他渠道/,
    );
    const invalidated = new Promise<void>((resolve) => {
      service.connection.resolve("tmall", tab.id).once("framenavigated", () => resolve());
    });
    await page.goto("https://example.com/unrelated");
    await invalidated;
    const channel = service.snapshot().channels.find((item) => item.platform === "tmall");
    assert.equal(channel?.tab, null);
    assert.equal(channel?.login.reason, "page_changed");
    await assert.rejects(() => service.execute({ type: "focus", platform: "tmall" }), /请先接入/);
  } finally {
    await service.dispose();
    await context.close();
  }
});

test("京东国际标签可按京东列出并显式接入，不改写地址或推定登录", async () => {
  const context = await native.newContext();
  let requests = 0;
  await context.route("**/*", async (route) => {
    requests++;
    await route.fulfill({ body: "<main>Offline international product</main>" });
  });
  const page = await context.newPage();
  const url = "https://npcitem.jd.hk/100020569664.html?tracking=PRIVATE#details";
  await page.goto(url);
  const service = new ExtensionService(connector, () => {});
  try {
    await service.execute({ type: "connect", input: { profileDirectory: null } });
    await service.connection.settled();
    const tabs = await service.execute({ type: "list", platform: "jd" });
    if (tabs.kind !== "tabs") throw new Error("expected tabs");
    assert.equal(tabs.value.length, 1);
    const tab = tabs.value[0];
    assert.equal(tab.url, "https://npcitem.jd.hk/100020569664.html");
    assert.equal(tab.title, "npcitem.jd.hk · 商品 100020569664");
    await service.execute({ type: "bind", input: { platform: "jd", tabId: tab.id } });
    const channel = service.snapshot().channels.find((item) => item.platform === "jd");
    assert.equal(channel?.tab?.id, tab.id);
    assert.equal(channel?.login.state, "unknown");
    assert.equal(page.url(), url);
    assert.equal(requests, 1);
    await service.execute({ type: "disconnect" });
    assert.equal(page.isClosed(), false);
  } finally {
    await service.dispose();
    await context.close();
  }
});
