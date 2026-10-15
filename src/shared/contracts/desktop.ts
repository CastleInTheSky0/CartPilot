import { z } from "zod";
import type {
  BindBrowserTabInput,
  BrowserState,
  BrowserTab,
  ConnectBrowserInput,
  Platform,
} from "./browser.ts";

export const DESKTOP_CHANNELS = {
  runtime: "desktop:runtime",
  browserState: "browser:state",
  browserConnect: "browser:connect",
  browserDisconnect: "browser:disconnect",
  browserListTabs: "browser:list-tabs",
  browserBindTab: "browser:bind-tab",
  browserRefreshLogin: "browser:refresh-login",
  browserFocusTab: "browser:focus-tab",
  browserInstall: "browser:install",
  browserChanged: "browser:changed",
} as const;

export const RuntimeInfoSchema = z.strictObject({
  version: z.string(),
  electron: z.string(),
  chromium: z.string(),
  node: z.string(),
  dataDirectory: z.string(),
  isPackaged: z.boolean(),
});

export type RuntimeInfo = z.infer<typeof RuntimeInfoSchema>;

export interface DesktopApi {
  getRuntimeInfo(): Promise<RuntimeInfo>;
  getBrowserState(): Promise<BrowserState>;
  connectBrowser(input: ConnectBrowserInput): Promise<BrowserState>;
  disconnectBrowser(): Promise<BrowserState>;
  listBrowserTabs(platform: Platform): Promise<BrowserTab[]>;
  bindBrowserTab(input: BindBrowserTabInput): Promise<BrowserState>;
  refreshBrowserLogin(platform: Platform): Promise<BrowserState>;
  focusBrowserTab(platform: Platform): Promise<BrowserState>;
  openExtensionInstall(): Promise<void>;
  onBrowserStateChanged(listener: (state: BrowserState) => void): () => void;
}
