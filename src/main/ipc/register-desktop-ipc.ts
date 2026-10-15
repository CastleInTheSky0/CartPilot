import { app, ipcMain, type BrowserWindow } from "electron";
import { z } from "zod";
import { DESKTOP_CHANNELS, RuntimeInfoSchema } from "../../shared/contracts/desktop.ts";
import { isTrustedRendererUrl } from "./renderer-access.ts";

export function registerDesktopIpc(window: BrowserWindow, rendererUrl: string): void {
  ipcMain.handle(DESKTOP_CHANNELS.runtime, (event, input: unknown) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      !isTrustedRendererUrl(event.senderFrame.url, rendererUrl)
    ) {
      throw new Error("当前页面无权访问桌面接口。");
    }
    z.undefined().parse(input);
    return RuntimeInfoSchema.parse({
      version: app.getVersion(),
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      node: process.versions.node,
      dataDirectory: app.getPath("userData"),
      isPackaged: app.isPackaged,
    });
  });
  window.once("closed", () => ipcMain.removeHandler(DESKTOP_CHANNELS.runtime));
}
