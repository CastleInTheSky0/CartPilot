import express from "express";
import path from "node:path";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { initStore, readWorkspace, readLogs, readSubmission, readAccessState, readBrowserConnection, writeJson } from "./store.ts";
import { AccessGuard } from "./access.ts";
import { createBrowser } from "./marketplace.ts";
import { isPlatform, validateSettings } from "./safety.ts";
import { PLATFORM_INFO, type RunMode, type Platform } from "../shared/types.ts";
import { TaskRunner } from "./runner.ts";
import { openExtensionInstall } from "./extension.ts";

await initStore();
const workspace = await readWorkspace();
const runner = new TaskRunner(
  workspace.plans[workspace.activePlatform],
  await readLogs(),
  await readSubmission(),
  workspace,
  createBrowser,
  new AccessGuard({ state: await readAccessState(), persist: (state) => writeJson("access-state.json", state) }),
  await readBrowserConnection(),
);
const app = express();
const port = Number(process.env.DUO_PORT || 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("DUO_PORT 需为 1024 至 65535 的端口号。");
const allowedHosts = new Set([
  `127.0.0.1:${port}`,
  `localhost:${port}`,
  "127.0.0.1:5173",
  "localhost:5173",
]);

app.disable("x-powered-by");
app.use((req, res, next) => {
  if (!allowedHosts.has(req.headers.host ?? ""))
    return void res.status(403).json({ error: "仅允许从本机访问。" });
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (
        !allowedHosts.has(new URL(origin).host) ||
        new URL(origin).protocol !== "http:"
      )
        return void res.status(403).json({ error: "访问来源不受支持。" });
    } catch {
      return void res.status(403).json({ error: "访问来源不受支持。" });
    }
  }
  if (req.path.startsWith("/api")) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method !== "GET" && req.headers["x-duo-client"] !== "1")
      return void res.status(403).json({ error: "请求缺少本地客户端标记。" });
  }
  next();
});
app.use(express.json({ limit: "20kb" }));

app.get("/api/state", (_req, res) => {
  res.json(runner.snapshot());
});
app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  const send = () => {
    res.write(`data: ${JSON.stringify(runner.snapshot())}\n\n`);
  };
  send();
  const unsubscribe = runner.subscribe(send);
  const heartbeat = setInterval(send, 15000);
  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

let mutating = false;
function action(work: (body: Record<string, unknown>) => Promise<void> | void) {
  return async (req: express.Request, res: express.Response) => {
    if (mutating)
      return void res
        .status(409)
        .json({ error: "上一个操作仍在处理中，请稍候。" });
    mutating = true;
    runner.state.browserBusy = true;
    runner.publish();
    try {
      await work(req.body ?? {});
      res.json({ ok: true, settings: runner.state.settings });
    } catch (error) {
      res
        .status(400)
        .json({
          error:
            error instanceof Error ? error.message : "操作未完成，请重试。",
        });
    } finally {
      mutating = false;
      runner.state.browserBusy = false;
      runner.publish();
    }
  };
}

app.post(
  "/api/settings",
  action(async (body) => {
    await runner.save(validateSettings(body), (body.mode ?? runner.state.workspace.mode) as RunMode,
      (body.enabledPlatforms ?? runner.state.workspace.enabledPlatforms) as Platform[]);
  }),
);
app.post("/api/platform", action(async (body) => {
  if (!isPlatform(body.platform)) throw new Error("平台不正确。");
  await runner.switchPlatform(body.platform);
}));
app.post("/api/browser/capture", action(async () => { await runner.captureProduct(); }));
app.post("/api/browser/login-status", action(async (body) => {
  if (!isPlatform(body.platform)) throw new Error("平台不正确。");
  await runner.refreshLogin(body.platform);
}));
app.post("/api/browser/connection", action(async (body) => { await runner.configureBrowser(body); }));
app.post("/api/browser/extension/install", action(() => { openExtensionInstall(runner.state.browserConnection.profileDirectory); }));
app.post("/api/browser/extension/connect", action(() => { runner.connectExtension(); }));
app.post("/api/browser/extension/disconnect", action(async () => { await runner.disconnectExtension(); }));
app.get("/api/browser/extension/tabs", async (req, res) => {
  if (!isPlatform(req.query.platform)) return void res.status(400).json({ error: "平台不正确。" });
  try { res.json({ tabs: await runner.extension.list(req.query.platform) }); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "无法读取标签页列表。" }); }
});
app.post("/api/browser/extension/bind", action(async (body) => {
  if (!isPlatform(body.platform) || typeof body.tabId !== "string") throw new Error("请选择当前平台的标签页。");
  await runner.bindExtensionTab(body.platform, body.tabId);
}));
app.post("/api/browser/review", action(async (body) => {
  if (!isPlatform(body.platform)) throw new Error("平台不正确。");
  await runner.reviewAccess(body.platform);
}));
app.post(
  "/api/browser/open",
  action(async (body) => {
    if (body.platform !== undefined && !isPlatform(body.platform)) throw new Error("平台不正确。");
    const platform = (body.platform as Platform | undefined) ?? runner.state.winner ?? runner.state.settings.platform;
    const browser = runner.getBrowser(platform);
    if (runner.active || body.focus === true || runner.access.issue(platform)) {
      await browser.focus();
      await runner.refreshLogin(platform);
      return;
    }
    if (body.login === true && browser.isOpen) { await browser.focus(); await runner.refreshLogin(platform); return; }
    const url = body.search === true ? PLATFORM_INFO[platform].searchUrl :
      body.login === true
        ? PLATFORM_INFO[platform].loginUrl
        : runner.state.workspace.plans[platform].productUrl;
    if (!url) throw new Error("请先填写商品链接，或点击查找商品。");
    await browser.open(url);
    await browser.focus();
    await runner.refreshLogin(platform);
    runner.log(
      "info",
      body.search === true ? "已打开商品搜索，请打开目标详情页后使用“读取当前商品”。" : body.login === true
        ? "登录浏览器已打开，请在平台登录并核对常用收货信息。"
        : "已打开商品购买页面。",
      platform,
    );
  }),
);
app.post(
  "/api/browser/inspect",
  action(async () => {
    await runner.inspect();
  }),
);
app.post(
  "/api/task/start",
  action((body) => {
    runner.start(body.immediate === true);
  }),
);
app.post(
  "/api/task/stop",
  action(async () => {
    await runner.stop();
  }),
);
app.post(
  "/api/task/resume",
  action((body) => {
    if (body.platform !== undefined && !isPlatform(body.platform)) throw new Error("平台不正确。");
    runner.resume(body.platform as Platform | undefined);
  }),
);
app.post(
  "/api/task/resolve-submission",
  action(async (body) => {
    if (body.reviewed !== true)
      throw new Error("请先确认已在官网核对订单结果。");
    await runner.resolveSubmission();
  }),
);
app.get("/api/logs/export", (_req, res) => {
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="duo-run-log.txt"',
  );
  res
    .type("text/plain; charset=utf-8")
    .send(
      runner.state.logs
        .map((log) => `[${log.at}] [${log.level}] ${log.message}`)
        .join("\n"),
    );
});
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "接口不存在。" });
});

const dist = path.resolve("dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get("/", (_req, res) => {
    res.sendFile(path.join(dist, "index.html"));
  });
} else
  app.get("/", (_req, res) => {
    res
      .status(503)
      .type("text")
      .send("请先运行 npm run build，或使用 npm run dev 启动开发环境。");
  });

const server = app.listen(port, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${port}`;
  console.log(
    `\nDuo 首发助手已启动：${url}\n请保持此窗口开启。关闭窗口会停止定时任务。\n`,
  );
  if (process.argv.includes("--open")) {
    if (process.platform === "win32")
      execFile("cmd.exe", ["/c", "start", "", url]);
    else if (process.platform === "darwin") execFile("open", [url]);
    else execFile("xdg-open", [url]);
  }
});
server.on("error", (error) => {
  console.error(
    (error as NodeJS.ErrnoException).code === "EADDRINUSE"
      ? `端口 ${port} 已被占用，请检查是否已启动首发助手。`
      : error.message,
  );
  process.exit(1);
});

// DOM reads in the already-open execution windows; no reloads or store requests.
let checkingLogins = false;
const loginTimer = setInterval(async () => {
  if (checkingLogins) return;
  checkingLogins = true;
  try { await runner.refreshLogins(); }
  catch { /* Unavailable pages are retried by the next local read. */ }
  finally { checkingLogins = false; }
}, 10_000);
loginTimer.unref();

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(loginTimer);
  await runner.stop();
  await runner.closeBrowsers();
  await runner.access.flush();
  server.close();
  process.exit(0);
}
process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
