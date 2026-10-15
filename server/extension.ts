import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { EXTENSION_INSTALL_URL } from "../shared/types.ts";
import { ExtensionConnection as SharedExtensionConnection } from "../src/main/infrastructure/browser/extension-connection.ts";
import {
  createOfficialConnector,
  type ExtensionConnector,
} from "../src/main/infrastructure/browser/official-connector.ts";
export { validBridgeEndpoint } from "../src/main/infrastructure/browser/bridge-endpoint.ts";
export type {
  ExtensionConnector,
  ExtensionSession,
} from "../src/main/infrastructure/browser/official-connector.ts";

export const connectOfficialExtension = createOfficialConnector({
  relayFile: fileURLToPath(new URL("./extension-host.ts", import.meta.url)),
  execArgv: ["--import", "tsx"],
});

export class ExtensionConnection extends SharedExtensionConnection {
  constructor(
    changed: () => void,
    connector: ExtensionConnector = connectOfficialExtension,
    timeoutMs = 120_000,
  ) {
    super(changed, connector, timeoutMs);
  }
}

export function openExtensionInstall(profile: string | null) {
  if (profile !== null && !/^(?:Default|Profile \d+)$/.test(profile))
    throw new Error("Chrome 资料目录不正确。");
  const executable = [
    process.env.PROGRAMFILES,
    process.env["PROGRAMFILES(X86)"],
    process.env.LOCALAPPDATA,
  ]
    .filter((root): root is string => !!root)
    .map((root) => path.join(root, "Google/Chrome/Application/chrome.exe"))
    .find(existsSync);
  if (!executable) throw new Error("未找到 Chrome，请手动使用日常浏览器打开安装链接。");
  const args = [...(profile ? [`--profile-directory=${profile}`] : []), EXTENSION_INSTALL_URL];
  const child = spawn(executable, args, {
    windowsHide: true,
    detached: true,
    shell: false,
    stdio: "ignore",
  });
  child.on("error", () => {});
  child.unref();
}
