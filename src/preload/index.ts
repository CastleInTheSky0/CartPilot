import { contextBridge, ipcRenderer } from "electron";
import { z } from "zod";
import {
  BindBrowserTabSchema,
  BrowserStateSchema,
  BrowserTabSchema,
  ConnectBrowserSchema,
  PlatformSchema,
} from "../shared/contracts/browser.ts";
import {
  DESKTOP_CHANNELS,
  RuntimeInfoSchema,
  type DesktopApi,
} from "../shared/contracts/desktop.ts";

const api: DesktopApi = {
  async getRuntimeInfo() {
    const result: unknown = await ipcRenderer.invoke(DESKTOP_CHANNELS.runtime);
    return RuntimeInfoSchema.parse(result);
  },
  async getBrowserState() {
    return BrowserStateSchema.parse(await ipcRenderer.invoke(DESKTOP_CHANNELS.browserState));
  },
  async getBrowserPreferences() {
    return ConnectBrowserSchema.parse(
      await ipcRenderer.invoke(DESKTOP_CHANNELS.browserPreferences),
    );
  },
  async connectBrowser(input) {
    return BrowserStateSchema.parse(
      await ipcRenderer.invoke(DESKTOP_CHANNELS.browserConnect, ConnectBrowserSchema.parse(input)),
    );
  },
  async disconnectBrowser() {
    return BrowserStateSchema.parse(await ipcRenderer.invoke(DESKTOP_CHANNELS.browserDisconnect));
  },
  async listBrowserTabs(platform) {
    return z
      .array(BrowserTabSchema)
      .parse(
        await ipcRenderer.invoke(DESKTOP_CHANNELS.browserListTabs, PlatformSchema.parse(platform)),
      );
  },
  async bindBrowserTab(input) {
    return BrowserStateSchema.parse(
      await ipcRenderer.invoke(DESKTOP_CHANNELS.browserBindTab, BindBrowserTabSchema.parse(input)),
    );
  },
  async refreshBrowserLogin(platform) {
    return BrowserStateSchema.parse(
      await ipcRenderer.invoke(
        DESKTOP_CHANNELS.browserRefreshLogin,
        PlatformSchema.parse(platform),
      ),
    );
  },
  async focusBrowserTab(platform) {
    return BrowserStateSchema.parse(
      await ipcRenderer.invoke(DESKTOP_CHANNELS.browserFocusTab, PlatformSchema.parse(platform)),
    );
  },
  async openExtensionInstall() {
    await ipcRenderer.invoke(DESKTOP_CHANNELS.browserInstall);
  },
  onBrowserStateChanged(listener) {
    const receive = (_event: Electron.IpcRendererEvent, input: unknown) => {
      const parsed = BrowserStateSchema.safeParse(input);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on(DESKTOP_CHANNELS.browserChanged, receive);
    return () => {
      ipcRenderer.removeListener(DESKTOP_CHANNELS.browserChanged, receive);
    };
  },
};

contextBridge.exposeInMainWorld("cartPilot", Object.freeze(api));
