import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { PLATFORMS } from "../../shared/types.ts";
import type {
  BindBrowserTabInput,
  BrowserState,
  BrowserTab,
  Platform,
} from "../../src/shared/contracts/browser.ts";
import type {} from "../../src/renderer/env.d.ts";

declare global {
  interface Window {
    fixtureListTabs(platform: Platform): Promise<BrowserTab[]>;
    fixtureBindTab(input: BindBrowserTabInput): Promise<void>;
    fixturePublishBrowser(state: BrowserState): void;
    fixtureListCompletions: number;
  }
}

export function browserState(connectedAt: string | null = null): BrowserState {
  return {
    connection: {
      phase: connectedAt ? "connected" : "disconnected",
      message: connectedAt ? "已连接普通 Chrome" : "尚未连接",
      connectedAt,
    },
    channels: PLATFORMS.map((platform) => ({
      platform,
      tab: null,
      login: { state: "unknown", reason: "browser_closed", message: "未检测", checkedAt: null },
    })),
  };
}

export async function launchBrowserUi(
  initial: BrowserState,
  list: (platform: Platform) => Promise<BrowserTab[]>,
  bind: (input: BindBrowserTabInput) => void = () => {},
) {
  const browser = await chromium.launch({ headless: true, channel: "chromium" });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(5000);
    await page.exposeFunction("fixtureListTabs", list);
    await page.exposeFunction("fixtureBindTab", bind);
    await page.route("http://cartpilot.fixture/**", (route) => {
      const pathname = new URL(route.request().url()).pathname;
      return route.fulfill({
        path: join(resolve("out/renderer"), pathname === "/" ? "index.html" : pathname),
      });
    });
    await page.addInitScript("window.__name = (value) => value;");
    await page.addInitScript((initialState) => {
      let state = initialState;
      const listeners = new Set<(value: BrowserState) => void>();
      window.fixtureListCompletions = 0;
      window.fixturePublishBrowser = (value) => {
        state = value;
        for (const listener of listeners) listener(state);
      };
      const unavailable = () => {
        throw new Error("此隔离测试不提供任务写入能力。");
      };
      window.cartPilot = {
        getRuntimeInfo: async () => ({
          version: "fixture",
          electron: "fixture",
          chromium: "fixture",
          node: "fixture",
          dataDirectory: "C:\\Isolated-Browser-UI",
          isPackaged: false,
          storage: {
            installationId: "214fcfb2-22c6-4f08-b9e9-46b87042f1b0",
            schemaVersion: 1,
            sqliteVersion: "fixture",
            databasePath: "C:\\Isolated-Browser-UI\\fixture.sqlite",
          },
        }),
        listPurchaseTasks: async () => [],
        getPurchaseTask: async () => unavailable(),
        createPurchaseTask: async () => unavailable(),
        getPurchaseTaskHistory: async () => unavailable(),
        getBrowserState: async () => state,
        getBrowserPreferences: async () => ({ profileDirectory: null }),
        connectBrowser: async () => state,
        disconnectBrowser: async () => state,
        listBrowserTabs: async (platform) => {
          try {
            return await window.fixtureListTabs(platform);
          } finally {
            window.fixtureListCompletions++;
          }
        },
        bindBrowserTab: async (input) => {
          await window.fixtureBindTab(input);
          return state;
        },
        refreshBrowserLogin: async () => state,
        focusBrowserTab: async () => state,
        openExtensionInstall: async () => {},
        onBrowserStateChanged: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      };
    }, initial);
    await page.goto("http://cartpilot.fixture/");
    await page.getByRole("button", { name: "浏览器连接", exact: true }).click();
    return { browser, page };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
