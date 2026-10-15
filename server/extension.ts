import { fork, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { chromium, type Browser, type Page } from "playwright";
import { EXTENSION_INSTALL_URL, type BrowserTab, type ExtensionConnectionState, type Platform } from "../shared/types.ts";
import { canonicalProductUrl, isPlatformUrl, productId, publicUrl } from "./safety.ts";

export type ExtensionSession = { browser: Browser; dispose(): Promise<void> };
export type ExtensionConnector = (profile: string | null, signal: AbortSignal) => Promise<ExtensionSession>;

export function validBridgeEndpoint(value: unknown): value is string {
  if (typeof value !== "string") return false;
  // Browser.bind uses a local socket unless a TCP port is explicitly requested.
  // Match the pinned bridge's own per-user browser socket, never arbitrary pipes.
  const hash = (input: string) => createHash("sha1").update(input).digest("hex").slice(0, 8);
  const user = hash(process.env.USERNAME || process.env.USER || "default");
  if (process.platform === "win32") {
    const suffix = process.env.PWTEST_SOCKETS_DIR ? `-${hash(process.env.PWTEST_SOCKETS_DIR)}` : "";
    const prefix = `\\\\.\\pipe\\pw-${user}-browser-browser@`;
    if (value.startsWith(prefix) && value.endsWith(suffix)) {
      const id = value.slice(prefix.length, suffix ? -suffix.length : undefined);
      if (/^[a-f0-9]{6}$/.test(id)) return true;
    }
  } else {
    const directory = path.join(process.env.PWTEST_SOCKETS_DIR || path.join(tmpdir(), `pw-${user}`), "browser");
    if (path.dirname(value) === directory && /^browser-[a-f0-9]{6}\.sock$/.test(path.basename(value))) return true;
  }
  try {
    const endpoint = new URL(value);
    return endpoint.protocol === "ws:" && ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname) && !!endpoint.port && !endpoint.username && !endpoint.password;
  } catch { return false; }
}

async function stopHost(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const forced = setTimeout(() => { child.kill(); resolve(); }, 2000);
    child.once("exit", () => { clearTimeout(forced); resolve(); });
    if (child.connected) child.send({ type: "stop" }, () => {});
    else child.kill();
  });
}

export const connectOfficialExtension: ExtensionConnector = async (profile, signal) => {
  signal.throwIfAborted();
  const env: NodeJS.ProcessEnv = { ...process.env, DUO_EXTENSION_PROFILE: profile ?? "" };
  // Each connection asks the user to authorize in the extension's own UI.
  for (const key of ["PLAYWRIGHT_MCP_EXTENSION_TOKEN", "PLAYWRIGHT_MCP_EXECUTABLE_PATH", "PLAYWRIGHT_MCP_PROFILE_DIR_NAME", "PWTEST_EXTENSION_USER_DATA_DIR"])
    delete env[key];
  const child = fork(fileURLToPath(new URL("./extension-host.ts", import.meta.url)), [], {
    execArgv: ["--import", "tsx"], env, windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  let browser: Browser | null = null;
  const aborted = () => { void stopHost(child); };
  signal.addEventListener("abort", aborted, { once: true });
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      const failed = (message: string) => reject(new Error(message));
      child.once("error", () => failed("普通浏览器连接进程未能启动，请重试。"));
      child.once("exit", () => failed("浏览器连接已结束，请重新连接。"));
      child.on("message", (message: { type?: string; endpoint?: unknown; code?: string }) => {
        if (message?.type === "ready") {
          if (validBridgeEndpoint(message.endpoint)) resolve(message.endpoint);
          else failed("扩展返回的本机连接地址不正确。");
        } else if (message?.type === "error") {
          failed(message.code === "extension_missing" ? "未找到官方扩展。请先在正常登录的 Chrome 中安装 Playwright Extension，再点击连接。" :
            message.code === "bridge_version" ? "扩展适配器需要 Playwright 1.64.1，请重新安装项目依赖。" : "连接失败，请确认扩展已启用，并在扩展页面允许本次连接。");
        }
      });
    });
    signal.throwIfAborted();
    browser = await chromium.connect(endpoint, { timeout: 15000 });
    signal.throwIfAborted();
    const connectedBrowser = browser;
    child.once("exit", () => { void connectedBrowser.close().catch(() => {}); });
    return {
      browser,
      async dispose() {
        // Stopping the host also breaks an unresponsive client pipe, so cleanup
        // cannot wait indefinitely for the parent connection to acknowledge close.
        await Promise.allSettled([connectedBrowser.close(), stopHost(child)]);
      },
    };
  } catch (error) {
    await Promise.allSettled([browser?.close(), stopHost(child)]);
    throw error;
  } finally { signal.removeEventListener("abort", aborted); }
};

export function openExtensionInstall(profile: string | null) {
  if (profile !== null && !/^(?:Default|Profile \d+)$/.test(profile)) throw new Error("Chrome 资料目录不正确。");
  const executable = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]
    .filter((root): root is string => !!root).map((root) => path.join(root, "Google/Chrome/Application/chrome.exe")).find(existsSync);
  if (!executable) throw new Error("未找到 Chrome，请手动使用日常浏览器打开安装链接。");
  const args = [...profile ? [`--profile-directory=${profile}`] : [], EXTENSION_INSTALL_URL];
  const child = spawn(executable, args, { windowsHide: true, detached: true, shell: false, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}

export class ExtensionConnection {
  state: ExtensionConnectionState = { phase: "disconnected", message: "尚未连接普通浏览器。", connectedAt: null };
  private session: ExtensionSession | null = null;
  private pending: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private revision = 0;
  private tabs = new Map<string, Page>();
  private ids = new WeakMap<Page, string>();
  constructor(private changed: () => void, private connector: ExtensionConnector = connectOfficialExtension, private timeoutMs = 120_000) {}
  get connected() { return this.state.phase === "connected" && !!this.session?.browser.isConnected(); }
  begin(profile: string | null) {
    if (this.state.phase === "connecting" || this.connected) throw new Error("浏览器已连接或正在连接。");
    if (profile !== null && !/^(?:Default|Profile \d+)$/.test(profile)) throw new Error("Chrome 资料目录不正确。");
    const revision = ++this.revision;
    const controller = this.controller = new AbortController();
    this.state = { phase: "connecting", message: "请在普通 Chrome 的扩展页面允许本次连接。", connectedAt: null };
    this.changed();
    this.pending = (async () => {
      const timeout = setTimeout(() => controller.abort(new Error("连接等待已超时，请重新连接并在扩展中确认。")), this.timeoutMs);
      timeout.unref();
      let session: ExtensionSession | null = null;
      try {
        session = await this.connector(profile, controller.signal);
        if (revision !== this.revision || controller.signal.aborted) { await session.dispose(); return; }
        this.session = session;
        session.browser.once("disconnected", () => {
          if (this.session !== session) return;
          this.session = null; this.tabs.clear(); this.ids = new WeakMap();
          this.state = { phase: "disconnected", message: "普通浏览器连接已断开，请重新连接并接入标签页。", connectedAt: null };
          this.changed();
          void session!.dispose().catch(() => {});
        });
        this.state = { phase: "connected", message: "已连接普通 Chrome，请为各平台选择要接入的标签页。", connectedAt: new Date().toISOString() };
        this.changed();
      } catch (error) {
        if (revision !== this.revision) return;
        this.state = { phase: "error", message: controller.signal.aborted ? String(controller.signal.reason?.message ?? "连接已取消。") : error instanceof Error ? error.message : "扩展连接失败，请重试。", connectedAt: null };
        this.changed();
      } finally { clearTimeout(timeout); }
    })();
  }
  async settled() { await this.pending; }
  async disconnect() {
    ++this.revision;
    this.controller?.abort();
    const session = this.session; this.session = null; this.tabs.clear(); this.ids = new WeakMap();
    this.state = { phase: "disconnected", message: "已断开连接，普通 Chrome 及其中的网页保留。", connectedAt: null };
    this.changed();
    await session?.dispose();
    await this.pending;
  }
  private visibleTabs(platform: Platform) {
    if (!this.connected) throw new Error("请先连接普通浏览器扩展。");
    return this.session!.browser.contexts().flatMap((context) => context.pages()).filter((page) => !page.isClosed() && isPlatformUrl(page.url(), platform));
  }
  async list(platform: Platform): Promise<BrowserTab[]> {
    const result: BrowserTab[] = [];
    for (const page of this.visibleTabs(platform)) {
      let id = this.ids.get(page);
      if (!id) { id = randomUUID(); this.ids.set(page, id); }
      this.tabs.set(id, page);
      // No account information, cookie storage, or unrelated page bodies are read.
      const url = canonicalProductUrl(page.url(), platform);
      const idOfProduct = productId(page.url(), platform);
      result.push({ id, title: new URL(url).hostname + (idOfProduct ? ` · 商品 ${idOfProduct}` : ""), url: idOfProduct ? url : publicUrl(url) });
    }
    return result;
  }
  resolve(platform: Platform, id: string): Page {
    if (!this.connected) throw new Error("扩展连接已断开，请重新连接。");
    const page = this.tabs.get(id);
    if (!page || page.isClosed() || !this.visibleTabs(platform).includes(page)) throw new Error("所选标签页已关闭或不属于当前平台，请刷新标签列表。");
    return page;
  }
}
