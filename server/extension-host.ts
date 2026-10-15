// Isolate the version-pinned official relay so cancelling its approval page can
// release every connection without closing the user's independently run Chrome.
import { createRequire } from "node:module";
import type { Browser } from "playwright";

const require = createRequire(import.meta.url);
const PINNED_VERSION = "1.64.1";
type BridgeTools = {
  createBrowserWithInfo(config: unknown, clientInfo: unknown, options: unknown, bind: unknown): Promise<{ browser: Browser; endpoint: string; ownership: string }>;
};
let browser: Browser | null = null;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const forcedExit = setTimeout(() => process.exit(0), 1500);
  forcedExit.unref();
  // Browser.close on this CDP connection only disconnects from the native browser.
  if (browser) {
    await browser.unbind().catch(() => {});
    await browser.close().catch(() => {});
  }
  process.exit(0);
}
process.on("disconnect", () => { void stop(); });
process.on("message", (message: { type?: string }) => { if (message?.type === "stop") void stop(); });
process.on("SIGTERM", () => { void stop(); });
process.on("SIGINT", () => { void stop(); });

try {
  if (require("playwright-core/package.json").version !== PINNED_VERSION) throw new Error("bridge_version");
  const { tools } = require("playwright-core/lib/coreBundle") as { tools: BridgeTools };
  const profileDirectory = process.env.DUO_EXTENSION_PROFILE || undefined;
  if (profileDirectory && !/^(?:Default|Profile \d+)$/.test(profileDirectory)) throw new Error("profile_invalid");
  const info = await tools.createBrowserWithInfo(
    { extension: true, browser: { browserName: "chromium", launchOptions: { headless: false }, contextOptions: {} }, timeouts: { idle: 0 } },
    { cwd: process.cwd(), clientName: "Duo 首发助手" },
    { browser: "chrome", profileDirName: profileDirectory },
    { title: "Duo 首发助手 · 普通浏览器", workspaceDir: process.cwd() },
  );
  if (stopping) { await info.browser.close(); process.exit(0); }
  browser = info.browser;
  browser.on("disconnected", () => { void stop(); });
  process.send?.({ type: "ready", endpoint: info.endpoint });
} catch (error) {
  const detail = error instanceof Error ? error.message : "";
  process.send?.({ type: "error", code: /Extension not found/.test(detail) ? "extension_missing" : detail === "bridge_version" ? "bridge_version" : "connection_failed" });
  await stop();
}
