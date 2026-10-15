import { randomUUID } from "node:crypto";
import type { Page } from "playwright";
import type { BrowserTab, ExtensionConnectionState, Platform } from "../../../../shared/types.ts";
import {
  canonicalProductUrl,
  isPlatformUrl,
  productId,
  publicUrl,
} from "../../../../server/safety.ts";
import type { ExtensionConnector, ExtensionSession } from "./official-connector.ts";

export class ExtensionConnection {
  state: ExtensionConnectionState = {
    phase: "disconnected",
    message: "尚未连接普通浏览器。",
    connectedAt: null,
  };
  private session: ExtensionSession | null = null;
  private pending: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private revision = 0;
  private tabs = new Map<string, Page>();
  private ids = new WeakMap<Page, string>();

  constructor(
    private changed: () => void,
    private connector: ExtensionConnector,
    private timeoutMs = 120_000,
  ) {}

  get connected(): boolean {
    return this.state.phase === "connected" && !!this.session?.browser.isConnected();
  }

  begin(profile: string | null): void {
    if (this.state.phase === "connecting" || this.connected)
      throw new Error("浏览器已连接或正在连接。");
    if (profile !== null && !/^(?:Default|Profile \d+)$/.test(profile))
      throw new Error("Chrome 资料目录不正确。");
    const revision = ++this.revision;
    const controller = (this.controller = new AbortController());
    this.state = {
      phase: "connecting",
      message: "请在普通 Chrome 的扩展页面允许本次连接。",
      connectedAt: null,
    };
    this.changed();
    this.pending = (async () => {
      const timeout = setTimeout(
        () => controller.abort(new Error("连接等待已超时，请重新连接并在扩展中确认。")),
        this.timeoutMs,
      );
      timeout.unref();
      try {
        const session = await this.connector(profile, controller.signal);
        if (revision !== this.revision || controller.signal.aborted) {
          await session.dispose();
          return;
        }
        this.session = session;
        session.browser.once("disconnected", () => {
          if (this.session !== session) return;
          this.session = null;
          this.tabs.clear();
          this.ids = new WeakMap();
          this.state = {
            phase: "disconnected",
            message: "普通浏览器连接已断开，请重新连接并接入标签页。",
            connectedAt: null,
          };
          this.changed();
          void session.dispose().catch(() => {});
        });
        this.state = {
          phase: "connected",
          message: "已连接普通 Chrome，请为各平台选择要接入的标签页。",
          connectedAt: new Date().toISOString(),
        };
        this.changed();
      } catch (error) {
        if (revision !== this.revision) return;
        this.state = {
          phase: "error",
          message: controller.signal.aborted
            ? "连接已取消或超时，请重新连接。"
            : error instanceof Error
              ? error.message
              : "扩展连接失败，请重试。",
          connectedAt: null,
        };
        this.changed();
      } finally {
        clearTimeout(timeout);
      }
    })();
  }

  async settled(): Promise<void> {
    await this.pending;
  }

  async disconnect(): Promise<void> {
    ++this.revision;
    this.controller?.abort();
    const session = this.session;
    this.session = null;
    this.tabs.clear();
    this.ids = new WeakMap();
    this.state = {
      phase: "disconnected",
      message: "已断开连接，普通 Chrome 及其中的网页保留。",
      connectedAt: null,
    };
    this.changed();
    await session?.dispose();
    await this.pending;
  }

  private visibleTabs(platform: Platform): Page[] {
    if (!this.connected || !this.session) throw new Error("请先连接普通浏览器扩展。");
    return this.session.browser
      .contexts()
      .flatMap((context) => context.pages())
      .filter((page) => !page.isClosed() && isPlatformUrl(page.url(), platform));
  }

  async list(platform: Platform): Promise<BrowserTab[]> {
    const result: BrowserTab[] = [];
    for (const page of this.visibleTabs(platform)) {
      let id = this.ids.get(page);
      if (!id) {
        id = randomUUID();
        this.ids.set(page, id);
      }
      this.tabs.set(id, page);
      const url = canonicalProductUrl(page.url(), platform);
      const idOfProduct = productId(page.url(), platform);
      result.push({
        id,
        title: new URL(url).hostname + (idOfProduct ? ` · 商品 ${idOfProduct}` : ""),
        url: idOfProduct ? url : publicUrl(url),
      });
    }
    return result;
  }

  resolve(platform: Platform, id: string): Page {
    if (!this.connected) throw new Error("扩展连接已断开，请重新连接。");
    const page = this.tabs.get(id);
    if (!page || page.isClosed() || !this.visibleTabs(platform).includes(page))
      throw new Error("所选标签页已关闭或不属于当前平台，请刷新标签列表。");
    return page;
  }
}
