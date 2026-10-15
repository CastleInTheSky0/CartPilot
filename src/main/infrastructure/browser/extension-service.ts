import type { Frame, Page } from "playwright";
import { PLATFORMS, LOGIN_STATUS_TTL, type LoginStatus } from "../../../../shared/types.ts";
import { readLoginStatus } from "../../../../server/login.ts";
import { isPlatformUrl } from "../../../../server/safety.ts";
import type {
  BrowserCommand,
  BrowserResult,
  BrowserState,
  BrowserTab,
  Platform,
} from "../../../shared/contracts/browser.ts";
import { ExtensionConnection } from "./extension-connection.ts";
import type { ExtensionConnector } from "./official-connector.ts";

type Binding = { page: Page; tab: BrowserTab; login: LoginStatus; cleanup(): void };
const unknownLogin = (): LoginStatus => ({
  state: "unknown",
  reason: "browser_closed",
  message: "尚未接入标签页，登录状态未检测。",
  checkedAt: null,
});

export class ExtensionService {
  readonly connection: ExtensionConnection;
  private bindings = new Map<Platform, Binding>();
  private invalidated = new Set<Platform>();
  private timer: ReturnType<typeof setInterval>;
  private reading = new Set<Binding>();

  constructor(
    connector: ExtensionConnector,
    private publish: (state: BrowserState) => void,
  ) {
    this.connection = new ExtensionConnection(() => {
      if (!this.connection.connected) this.clearBindings();
      this.emit();
    }, connector);
    this.timer = setInterval(() => {
      for (const platform of this.bindings.keys()) void this.refresh(platform).catch(() => {});
    }, 10_000);
    this.timer.unref();
  }

  snapshot(): BrowserState {
    return {
      connection: { ...this.connection.state },
      channels: PLATFORMS.map((platform) => {
        const binding = this.bindings.get(platform);
        let login =
          binding?.login ??
          (this.invalidated.has(platform)
            ? {
                ...unknownLogin(),
                reason: "page_changed" as const,
                message: "接入页面已变化或关闭，请重新选择标签页。",
              }
            : unknownLogin());
        if (login.checkedAt && Date.now() - Date.parse(login.checkedAt) > LOGIN_STATUS_TTL)
          login = {
            ...login,
            state: "unknown",
            reason: "stale",
            message: "检测已过期，请重新检测登录状态。",
          };
        return { platform, tab: binding?.tab ?? null, login };
      }),
    };
  }

  async execute(command: BrowserCommand): Promise<BrowserResult> {
    switch (command.type) {
      case "connect":
        this.connection.begin(command.input.profileDirectory);
        break;
      case "disconnect":
        await this.connection.disconnect();
        break;
      case "list":
        return { kind: "tabs", value: await this.connection.list(command.platform) };
      case "bind":
        await this.bind(command.input.platform, command.input.tabId);
        break;
      case "refresh":
        await this.refresh(command.platform);
        break;
      case "focus":
        await this.selected(command.platform).page.bringToFront();
        break;
      case "status":
        break;
    }
    return { kind: "state", value: this.snapshot() };
  }

  async dispose(): Promise<void> {
    clearInterval(this.timer);
    this.clearBindings();
    await this.connection.disconnect();
  }

  private selected(platform: Platform): Binding {
    const binding = this.bindings.get(platform);
    if (!binding || binding.page.isClosed()) throw new Error("请先接入此平台的标签页。");
    return binding;
  }

  private async bind(platform: Platform, id: string): Promise<void> {
    const page = this.connection.resolve(platform, id);
    if (
      [...this.bindings.entries()].some(
        ([owner, binding]) => owner !== platform && binding.page === page,
      )
    )
      throw new Error("此标签页已接入其他渠道。");
    const tab = (await this.connection.list(platform)).find((candidate) => candidate.id === id);
    if (!tab) throw new Error("标签页已变化，请刷新列表后重试。");
    this.bindings.get(platform)?.cleanup();
    const changed = (frame?: Frame) => {
      if (frame && frame !== page.mainFrame()) return;
      this.bindings.get(platform)?.cleanup();
      this.bindings.delete(platform);
      this.invalidated.add(platform);
      this.emit();
    };
    const closed = () => changed();
    page.on("close", closed);
    page.on("framenavigated", changed);
    this.bindings.set(platform, {
      page,
      tab,
      login: unknownLogin(),
      cleanup: () => {
        page.off("close", closed);
        page.off("framenavigated", changed);
      },
    });
    this.invalidated.delete(platform);
    this.emit();
    await this.refresh(platform);
  }

  private async refresh(platform: Platform): Promise<void> {
    const binding = this.selected(platform);
    if (this.reading.has(binding)) return;
    this.reading.add(binding);
    try {
      const url = binding.page.url();
      if (!isPlatformUrl(url, platform)) return;
      const login = await readLoginStatus(binding.page, platform);
      if (this.bindings.get(platform) === binding && binding.page.url() === url) {
        binding.login = login;
        this.emit();
      }
    } finally {
      this.reading.delete(binding);
    }
  }

  private clearBindings(): void {
    for (const binding of this.bindings.values()) binding.cleanup();
    this.bindings.clear();
    this.invalidated.clear();
  }

  private emit(): void {
    this.publish(this.snapshot());
  }
}
