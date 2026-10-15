import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import test from "node:test";
import { launchDesktop } from "./desktop-fixture.ts";
import type {} from "../../src/renderer/env.d.ts";

test("构建后的桌面可独立启动，renderer 只有受限 preload 能力", { timeout: 45_000 }, async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "cartpilot-desktop-"));
  const application = await launchDesktop(dataDirectory);
  try {
    const page = await application.firstWindow();
    await page.getByRole("heading", { name: "购买工作台", exact: true }).waitFor();
    await page.getByRole("button", { name: "应用设置", exact: true }).click();
    await page.getByText(dataDirectory, { exact: true }).waitFor();
    await page.getByRole("button", { name: "浏览器连接", exact: true }).click();
    const runtime = await page.evaluate(() => window.cartPilot.getRuntimeInfo());
    assert.equal(runtime.isPackaged, Boolean(process.env.CARTPILOT_EXECUTABLE));
    assert.equal(await page.evaluate(() => "require" in window), false);
    assert.equal(await page.evaluate(() => "process" in window), false);
    const methods = await page.evaluate(() => Object.keys(window.cartPilot));
    assert.ok(methods.includes("getRuntimeInfo"));
    assert.equal(
      methods.some((method) => /exec|script|sql|cookie/i.test(method)),
      false,
    );
    await page.getByRole("button", { name: "连接普通 Chrome" }).waitFor();
    const browserState = await page.evaluate(() => window.cartPilot.getBrowserState());
    assert.equal(browserState.connection.phase, "disconnected");
    assert.equal(browserState.channels.length, 5);
    await page.getByText("Chrome 资料目录（可选）", { exact: true }).click();
    await page.getByRole("textbox", { name: "可选资料目录名" }).fill("Profile 999999999");
    await page.getByRole("button", { name: "连接普通 Chrome", exact: true }).click();
    await page.getByText(/未找到官方扩展/).waitFor();
    const failed = await page.evaluate(() => window.cartPilot.getBrowserState());
    assert.equal(failed.connection.phase, "error");
    await page.getByRole("button", { name: "使用说明", exact: true }).click();
    await page.getByRole("heading", { name: "三步完成浏览器接入" }).waitFor();
    await page.getByRole("button", { name: "前往浏览器连接", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "扩展连接异常" }).waitFor();
    await page.getByText("Chrome 资料目录（可选）", { exact: true }).click();
    assert.equal(
      await page.getByRole("textbox", { name: "可选资料目录名" }).inputValue(),
      "Profile 999999999",
    );
    await page.evaluate(() => window.cartPilot.disconnectBrowser());
    await page.getByRole("status").filter({ hasText: "未连接" }).waitFor();
    await page.getByText("Chrome 资料目录（可选）", { exact: true }).click();
    const preferences = await application
      .browserWindow(page)
      .then((window) => window.evaluate((value) => value.webContents.getLastWebPreferences()));
    assert.equal(preferences.contextIsolation, true);
    assert.equal(preferences.sandbox, true);
    assert.equal(preferences.nodeIntegration, false);
    await page.evaluate(() => {
      window.open("https://example.com/");
    });
    assert.equal(application.windows().length, 1);
    await mkdir(resolve("output/playwright"), { recursive: true });
    const name = process.env.CARTPILOT_EXECUTABLE ? "installed-desktop.png" : "desktop.png";
    await page.evaluate(() => window.scrollTo({ top: 0 }));
    await page.screenshot({ path: resolve("output/playwright", name), fullPage: true });
  } finally {
    await application.close();
  }
});
