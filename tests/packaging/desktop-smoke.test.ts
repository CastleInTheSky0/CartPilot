import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import test from "node:test";
import { _electron } from "playwright";
import type {} from "../../src/renderer/env.d.ts";

test("构建后的桌面可独立启动，renderer 只有受限 preload 能力", { timeout: 45_000 }, async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "cartpilot-desktop-"));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== "ELECTRON_RUN_AS_NODE") env[key] = value;
  }
  env.CARTPILOT_DATA_DIR = dataDirectory;
  const application = await _electron.launch({ args: [resolve(".")], env });
  try {
    const page = await application.firstWindow();
    await page.getByRole("heading", { name: "先连接你的日常浏览器" }).waitFor();
    await page.getByText(dataDirectory, { exact: true }).waitFor();
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
    await page.evaluate(() =>
      window.cartPilot.connectBrowser({ profileDirectory: "Profile 999999999" }),
    );
    await page.getByText(/未找到官方扩展/).waitFor();
    const failed = await page.evaluate(() => window.cartPilot.getBrowserState());
    assert.equal(failed.connection.phase, "error");
    await page.evaluate(() => window.cartPilot.disconnectBrowser());
    await page.getByRole("status").filter({ hasText: "未连接" }).waitFor();
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
    await page.screenshot({ path: resolve("output/playwright/desktop.png"), fullPage: true });
  } finally {
    await application.close();
  }
});
