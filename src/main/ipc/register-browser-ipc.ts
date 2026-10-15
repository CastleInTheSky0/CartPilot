import { shell, type BrowserWindow } from "electron";
import { z } from "zod";
import { EXTENSION_INSTALL_URL } from "../../../shared/types.ts";
import {
  BindBrowserTabSchema,
  ConnectBrowserSchema,
  PlatformSchema,
  type BrowserCommand,
} from "../../shared/contracts/browser.ts";
import { DESKTOP_CHANNELS } from "../../shared/contracts/desktop.ts";
import type { BrowserWorkerClient } from "../infrastructure/browser/browser-worker-client.ts";
import { isTrustedRendererUrl } from "./renderer-access.ts";
import { registerValidatedHandler } from "./validated-handler.ts";

export function registerBrowserIpc(
  window: BrowserWindow,
  rendererUrl: string,
  browser: BrowserWorkerClient,
): void {
  const state = async (command: BrowserCommand) => {
    const result = await browser.execute(command);
    if (result.kind !== "state") throw new Error("浏览器状态响应不正确。");
    return result.value;
  };
  const register = <Input, Output>(
    channel: string,
    schema: z.ZodType<Input>,
    handle: (input: Input) => Output | Promise<Output>,
  ) => registerValidatedHandler(window, rendererUrl, channel, schema, handle);
  register(DESKTOP_CHANNELS.browserState, z.undefined(), () => state({ type: "status" }));
  register(DESKTOP_CHANNELS.browserConnect, ConnectBrowserSchema, (input) =>
    state({ type: "connect", input }),
  );
  register(DESKTOP_CHANNELS.browserDisconnect, z.undefined(), () => state({ type: "disconnect" }));
  register(DESKTOP_CHANNELS.browserListTabs, PlatformSchema, async (platform) => {
    const result = await browser.execute({ type: "list", platform });
    if (result.kind !== "tabs") throw new Error("标签列表响应不正确。");
    return result.value;
  });
  register(DESKTOP_CHANNELS.browserBindTab, BindBrowserTabSchema, (input) =>
    state({ type: "bind", input }),
  );
  register(DESKTOP_CHANNELS.browserRefreshLogin, PlatformSchema, (platform) =>
    state({ type: "refresh", platform }),
  );
  register(DESKTOP_CHANNELS.browserFocusTab, PlatformSchema, (platform) =>
    state({ type: "focus", platform }),
  );
  register(DESKTOP_CHANNELS.browserInstall, z.undefined(), () =>
    shell.openExternal(EXTENSION_INSTALL_URL),
  );
  const unsubscribe = browser.subscribe((value) => {
    if (!window.isDestroyed() && isTrustedRendererUrl(window.webContents.getURL(), rendererUrl))
      window.webContents.send(DESKTOP_CHANNELS.browserChanged, value);
  });
  window.once("closed", unsubscribe);
}
