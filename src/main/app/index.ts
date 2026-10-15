import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog } from "electron";
import { registerDesktopIpc } from "../ipc/register-desktop-ipc.ts";
import { registerBrowserIpc } from "../ipc/register-browser-ipc.ts";
import { BrowserWorkerClient } from "../infrastructure/browser/browser-worker-client.ts";
import { isTrustedRendererUrl, rendererContentSecurityPolicy } from "../ipc/renderer-access.ts";

app.setName("CartPilot");
const dataDirectory = process.env.CARTPILOT_DATA_DIR;
if (dataDirectory) {
  if (!isAbsolute(dataDirectory)) throw new Error("CARTPILOT_DATA_DIR 必须是绝对路径。");
  app.setPath("userData", dataDirectory);
}

let window: BrowserWindow | null = null;
const browser = new BrowserWorkerClient();

async function createWindow(): Promise<void> {
  const developmentUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL;
  const rendererUrl =
    developmentUrl ?? pathToFileURL(join(__dirname, "../renderer/index.html")).href;
  window = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 760,
    minHeight: 600,
    title: "CartPilot",
    backgroundColor: "#f6f6f4",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  });
  const contents = window.webContents;
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event, url) => {
    if (!isTrustedRendererUrl(url, rendererUrl)) event.preventDefault();
  });
  contents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  contents.session.setPermissionCheckHandler(() => false);
  contents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [rendererContentSecurityPolicy(developmentUrl)],
      },
    });
  });
  registerDesktopIpc(window, rendererUrl);
  registerBrowserIpc(window, rendererUrl, browser);
  window.once("ready-to-show", () => window?.show());
  window.once("closed", () => {
    window = null;
  });
  await window.loadURL(rendererUrl);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let isQuitting = false;
  app.on("before-quit", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    isQuitting = true;
    void browser.dispose().finally(() => app.quit());
  });
  app.on("second-instance", () => {
    if (window?.isMinimized()) window.restore();
    window?.show();
    window?.focus();
  });
  app.on("window-all-closed", () => app.quit());
  void app
    .whenReady()
    .then(createWindow)
    .catch((error: unknown) => {
      dialog.showErrorBox(
        "CartPilot 启动失败",
        error instanceof Error ? error.message : "无法启动应用。",
      );
      app.exit(1);
    });
}
