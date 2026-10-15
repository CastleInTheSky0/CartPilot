import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import type { Page } from "playwright";
import type { BindBrowserTabInput, BrowserTab } from "../../src/shared/contracts/browser.ts";
import { browserState, launchBrowserUi } from "../fixtures/browser-ui.ts";

const first: BrowserTab = {
  id: "cf65ef68-98f7-45c9-af6c-3de9b624c6bf",
  title: "npcitem.jd.hk · 商品 100020569664",
  url: "https://npcitem.jd.hk/100020569664.html",
};
const second: BrowserTab = {
  id: "12ed5b48-14d4-4633-b6a3-2aa4bd9e4317",
  title: "item.jd.com · 商品 123",
  url: "https://item.jd.com/123.html",
};
const connectedAt = "2026-10-15T14:00:00.000Z";

async function completed(page: Page, count: number) {
  await page.waitForFunction((value) => window.fixtureListCompletions >= value, count);
  await page.evaluate(() => new Promise(requestAnimationFrame));
}

test("连接后自动读取页面，刷新保留所选京东国际标签且仅显式接入", async () => {
  const bindings: BindBrowserTabInput[] = [];
  const { browser, page } = await launchBrowserUi(
    browserState(),
    async () => [first, second],
    (input) => bindings.push(input),
  );
  try {
    const picker = page.getByRole("combobox", { name: "选择已打开的页面", exact: true });
    assert.equal(await picker.isDisabled(), true);
    await page.evaluate((state) => window.fixturePublishBrowser(state), browserState(connectedAt));
    await page
      .getByRole("status", { name: "标签页列表状态" })
      .filter({ hasText: "找到 2 个" })
      .waitFor();
    assert.equal(await picker.isEnabled(), true);
    assert.deepEqual(bindings, []);
    await picker.selectOption(second.id);
    await page.getByRole("button", { name: "刷新列表", exact: true }).click();
    await completed(page, 2);
    assert.equal(await picker.inputValue(), second.id);
    await picker.selectOption(first.id);
    await page.getByRole("button", { name: "接入所选标签页", exact: true }).click();
    assert.deepEqual(bindings, [{ platform: "jd", tabId: first.id }]);
    await mkdir(resolve("output/playwright"), { recursive: true });
    await page.screenshot({
      path: resolve("output/playwright/jd-international-picker.png"),
      fullPage: true,
    });
    for (const width of [760, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
    }
  } finally {
    await browser.close();
  }
});

test("空列表说明授权范围，读取失败显示错误并可刷新恢复", async () => {
  let result: BrowserTab[] | Error = [];
  const { browser, page } = await launchBrowserUi(browserState(connectedAt), async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  try {
    const picker = page.getByRole("combobox", { name: "选择已打开的页面", exact: true });
    await page
      .getByRole("status", { name: "标签页列表状态" })
      .filter({ hasText: "未找到已授权的京东页面" })
      .waitFor();
    await page.getByText(/将商城标签页拖入 Chrome/).waitFor();
    assert.equal(await picker.isDisabled(), true);
    result = new Error("扩展读取失败，请重试。");
    await page.getByRole("button", { name: "刷新列表", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "扩展读取失败" }).waitFor();
    assert.equal(await picker.isDisabled(), true);
    result = [first];
    await page.getByRole("button", { name: "刷新列表", exact: true }).click();
    await page
      .getByRole("status", { name: "标签页列表状态" })
      .filter({ hasText: "找到 1 个" })
      .waitFor();
    assert.equal(await picker.inputValue(), first.id);
    assert.equal(await page.getByRole("alert").count(), 0);
  } finally {
    await browser.close();
  }
});

test("切换平台和重连后丢弃旧列表及错误，断开后不能使用旧标识", async () => {
  let rejectOld = (_error: Error) => {};
  let resolveOld = (_tabs: BrowserTab[]) => {};
  const firstRequest = new Promise<BrowserTab[]>((_resolve, reject) => {
    rejectOld = reject;
  });
  const secondRequest = new Promise<BrowserTab[]>((resolveTabs) => {
    resolveOld = resolveTabs;
  });
  let jdRequests = 0;
  const { browser, page } = await launchBrowserUi(browserState(connectedAt), async (platform) => {
    if (platform !== "jd") return [];
    jdRequests++;
    return jdRequests === 1 ? firstRequest : jdRequests === 2 ? secondRequest : [first];
  });
  try {
    const picker = page.getByRole("combobox", { name: "选择已打开的页面", exact: true });
    const platform = page.getByRole("combobox", { name: "选择平台", exact: true });
    await page.getByRole("button", { name: "正在读取…", exact: true }).waitFor();
    await platform.selectOption("taobao");
    await page
      .getByRole("status", { name: "标签页列表状态" })
      .filter({ hasText: "未找到已授权的淘宝页面" })
      .waitFor();
    rejectOld(new Error("过期的京东请求错误"));
    await completed(page, 2);
    assert.equal(await page.getByRole("alert").count(), 0);
    await platform.selectOption("jd");
    await page.getByRole("button", { name: "正在读取…", exact: true }).waitFor();
    await page.evaluate((state) => window.fixturePublishBrowser(state), browserState());
    assert.equal(await picker.isDisabled(), true);
    await page.evaluate(
      (state) => window.fixturePublishBrowser(state),
      browserState("2026-10-15T14:01:00.000Z"),
    );
    await page
      .getByRole("status", { name: "标签页列表状态" })
      .filter({ hasText: "找到 1 个" })
      .waitFor();
    resolveOld([second]);
    await completed(page, 4);
    assert.equal(await picker.inputValue(), first.id);
    assert.equal(await picker.locator("option").count(), 1);
    assert.equal(await page.getByRole("alert").count(), 0);
  } finally {
    resolveOld([]);
    rejectOld(new Error("测试结束"));
    await browser.close();
  }
});
