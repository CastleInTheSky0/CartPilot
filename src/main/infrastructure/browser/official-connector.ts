import { fork, type ChildProcess } from "node:child_process";
import { chromium, type Browser } from "playwright";
import { z } from "zod";
import { validBridgeEndpoint } from "./bridge-endpoint.ts";

export type ExtensionSession = { browser: Browser; dispose(): Promise<void> };
export type ExtensionConnector = (
  profile: string | null,
  signal: AbortSignal,
) => Promise<ExtensionSession>;

const RelayMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("ready"), endpoint: z.string() }),
  z.strictObject({ type: z.literal("error"), code: z.string() }),
]);

async function stopHost(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const forced = setTimeout(() => {
      child.kill();
      resolve();
    }, 2000);
    child.once("exit", () => {
      clearTimeout(forced);
      resolve();
    });
    if (child.connected) child.send({ type: "stop" }, () => {});
    else child.kill();
  });
}

export function createOfficialConnector(options: {
  relayFile: string;
  execArgv?: string[];
  runAsNode?: boolean;
}): ExtensionConnector {
  return async (profile, signal) => {
    signal.throwIfAborted();
    const env: NodeJS.ProcessEnv = { ...process.env, DUO_EXTENSION_PROFILE: profile ?? "" };
    for (const key of [
      "PLAYWRIGHT_MCP_EXTENSION_TOKEN",
      "PLAYWRIGHT_MCP_EXECUTABLE_PATH",
      "PLAYWRIGHT_MCP_PROFILE_DIR_NAME",
      "PWTEST_EXTENSION_USER_DATA_DIR",
    ])
      delete env[key];
    if (options.runAsNode) env.ELECTRON_RUN_AS_NODE = "1";
    const child = fork(options.relayFile, [], {
      execArgv: options.execArgv ?? [],
      env,
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    let browser: Browser | null = null;
    const aborted = () => {
      void stopHost(child);
    };
    signal.addEventListener("abort", aborted, { once: true });
    try {
      const endpoint = await new Promise<string>((resolve, reject) => {
        const failed = (message: string) => reject(new Error(message));
        child.once("error", () => failed("普通浏览器连接进程未能启动，请重试。"));
        child.once("exit", () => failed("浏览器连接已结束，请重新连接。"));
        child.on("message", (input: unknown) => {
          const parsed = RelayMessageSchema.safeParse(input);
          if (!parsed.success) {
            failed("扩展返回的连接消息不正确。");
            return;
          }
          const message = parsed.data;
          if (message.type === "ready") {
            if (validBridgeEndpoint(message.endpoint)) resolve(message.endpoint);
            else failed("扩展返回的本机连接地址不正确。");
          } else {
            failed(
              message.code === "extension_missing"
                ? "未找到官方扩展。请先在所选 Chrome 资料中安装 Playwright Extension，再点击连接。"
                : message.code === "bridge_version"
                  ? "扩展适配器需要 Playwright 1.64.1，请重新安装项目依赖。"
                  : "连接失败，请确认扩展已启用，并在扩展页面允许本次连接。",
            );
          }
        });
      });
      signal.throwIfAborted();
      browser = await chromium.connect(endpoint, { timeout: 15000 });
      signal.throwIfAborted();
      const connectedBrowser = browser;
      child.once("exit", () => {
        void connectedBrowser.close().catch(() => {});
      });
      return {
        browser,
        async dispose() {
          await Promise.allSettled([connectedBrowser.close(), stopHost(child)]);
        },
      };
    } catch (error) {
      await Promise.allSettled([browser?.close(), stopHost(child)]);
      throw error;
    } finally {
      signal.removeEventListener("abort", aborted);
    }
  };
}
