/// <reference path="./playwright-bridge.d.ts" />
import { setDefaultResultOrder } from "node:dns";
import { tools } from "playwright-core/lib/coreBundle";
import { version } from "playwright-core/package.json";
import type { Browser } from "playwright";
import { z } from "zod";

export async function runOfficialRelay(): Promise<void> {
  let browser: Browser | null = null;
  let stopping = false;
  async function stop(): Promise<void> {
    if (stopping) return;
    stopping = true;
    const forcedExit = setTimeout(() => process.exit(0), 1500);
    forcedExit.unref();
    if (browser) {
      await browser.unbind().catch(() => {});
      await browser.close().catch(() => {});
    }
    process.exit(0);
  }
  process.on("disconnect", () => {
    void stop();
  });
  process.on("message", (input: unknown) => {
    if (z.strictObject({ type: z.literal("stop") }).safeParse(input).success) void stop();
  });
  process.on("SIGTERM", () => {
    void stop();
  });
  process.on("SIGINT", () => {
    void stop();
  });

  try {
    if (version !== "1.64.1") throw new Error("bridge_version");
    // 官方中继监听 localhost；部分 Windows 环境拒绝访问 ::1，只在中继进程优先 IPv4。
    setDefaultResultOrder("ipv4first");
    const profileDirectory = z
      .string()
      .regex(/^(?:Default|Profile \d+)$/)
      .optional()
      .parse(process.env.DUO_EXTENSION_PROFILE || undefined);
    const info = await tools.createBrowserWithInfo(
      {
        extension: true,
        browser: {
          browserName: "chromium",
          launchOptions: { headless: false },
          contextOptions: {},
        },
        timeouts: { idle: 0 },
      },
      { cwd: process.cwd(), clientName: "CartPilot 购买助手" },
      { browser: "chrome", profileDirName: profileDirectory },
      { title: "CartPilot · 普通浏览器", workspaceDir: process.cwd() },
    );
    if (stopping) {
      await info.browser.close();
      process.exit(0);
    }
    browser = info.browser;
    browser.on("disconnected", () => {
      void stop();
    });
    process.send?.({ type: "ready", endpoint: info.endpoint });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    process.send?.({
      type: "error",
      code: /Extension not found/.test(detail)
        ? "extension_missing"
        : detail === "bridge_version"
          ? "bridge_version"
          : "connection_failed",
    });
    await stop();
  }
}
