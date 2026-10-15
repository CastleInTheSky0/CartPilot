import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { z } from "zod";
import { isTrustedRendererUrl } from "./renderer-access.ts";

export function validateRenderer(
  event: IpcMainInvokeEvent,
  window: BrowserWindow,
  rendererUrl: string,
): void {
  if (
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    !isTrustedRendererUrl(event.senderFrame.url, rendererUrl)
  )
    throw new Error("当前页面无权访问桌面接口。");
}

export function registerValidatedHandler<Input, Output>(
  window: BrowserWindow,
  rendererUrl: string,
  channel: string,
  schema: z.ZodType<Input>,
  handle: (input: Input) => Output | Promise<Output>,
): void {
  ipcMain.handle(channel, (event, input: unknown) => {
    validateRenderer(event, window, rendererUrl);
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new Error("桌面命令参数不正确，请检查填写内容。");
    return handle(parsed.data);
  });
  window.once("closed", () => ipcMain.removeHandler(channel));
}
