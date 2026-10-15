import { app, type BrowserWindow } from "electron";
import { z } from "zod";
import { DESKTOP_CHANNELS, RuntimeInfoSchema } from "../../shared/contracts/desktop.ts";
import { registerValidatedHandler } from "./validated-handler.ts";

export function registerDesktopIpc(window: BrowserWindow, rendererUrl: string): void {
  registerValidatedHandler(window, rendererUrl, DESKTOP_CHANNELS.runtime, z.undefined(), () => {
    return RuntimeInfoSchema.parse({
      version: app.getVersion(),
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      node: process.versions.node,
      dataDirectory: app.getPath("userData"),
      isPackaged: app.isPackaged,
    });
  });
}
