import {
  mkdir,
  readFile,
  writeFile,
  appendFile,
  rename,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_SETTINGS,
  type Settings,
  type LogEntry,
  type Submission,
  defaultWorkspace,
  type Workspace,
  type BrowserConnectionConfig,
} from "../shared/types.ts";
import { validateSettings, validateWorkspace } from "./safety.ts";
import { validateAccessState, type AccessState } from "./access.ts";

export const DATA_DIR = path.resolve(process.env.DUO_DATA_DIR || ".data");
let writeSequence = Promise.resolve();

export async function initStore() {
  await mkdir(DATA_DIR, { recursive: true });
}

export async function readSettings(): Promise<Settings> {
  try {
    return validateSettings(
      JSON.parse(await readFile(path.join(DATA_DIR, "settings.json"), "utf8")),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return structuredClone(DEFAULT_SETTINGS);
    throw new Error(
      "本地设置无法读取。请先检查 .data/settings.json，避免使用错误配置。",
    );
  }
}

export async function readWorkspace(): Promise<Workspace> {
  try {
    return validateWorkspace(JSON.parse(await readFile(path.join(DATA_DIR, "workspace.json"), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultWorkspace(await readSettings());
    throw new Error("本地平台配置无法读取，请检查 .data/workspace.json 后再启动。");
  }
}

export async function readAccessState(): Promise<AccessState> {
  try {
    return validateAccessState(JSON.parse(await readFile(path.join(DATA_DIR, "access-state.json"), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, restrictions: {} };
    throw new Error("访问限制记录无法读取，请检查 .data/access-state.json 后再启动。");
  }
}

export function validateBrowserConnection(input: unknown): BrowserConnectionConfig {
  const config = input as Partial<BrowserConnectionConfig> | null;
  if (!config || config.version !== 1 || !["extension", "managed"].includes(config.mode ?? "") ||
    (config.profileDirectory !== null && (typeof config.profileDirectory !== "string" || !/^(?:Default|Profile \d+)$/.test(config.profileDirectory))))
    throw new Error("浏览器连接配置不正确，资料目录应为 Default 或 Profile 1 等目录名。");
  return { version: 1, mode: config.mode!, profileDirectory: config.profileDirectory };
}

export async function readBrowserConnection(): Promise<BrowserConnectionConfig> {
  try { return validateBrowserConnection(JSON.parse(await readFile(path.join(DATA_DIR, "browser-connection.json"), "utf8"))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, mode: "extension", profileDirectory: null };
    throw new Error("浏览器连接配置无法读取，请检查 .data/browser-connection.json。");
  }
}

export function writeJson(name: string, value: unknown): Promise<void> {
  const work = writeSequence.then(async () => {
    const target = path.join(DATA_DIR, name);
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
    await rename(temporary, target);
  });
  writeSequence = work.catch(() => {});
  return work;
}

export async function readSubmission(): Promise<Submission | null> {
  try {
    const value = JSON.parse(
      await readFile(path.join(DATA_DIR, "submission.json"), "utf8"),
    ) as Submission;
    if (
      !value ||
      typeof value.runId !== "string" ||
      !["unknown", "confirmed"].includes(value.result) ||
      typeof value.at !== "string"
    )
      throw new Error("invalid");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(
      "订单提交记录无法读取。请核对 .data/submission.json 后再启动。",
    );
  }
}

export async function readLogs(): Promise<LogEntry[]> {
  try {
    return (await readFile(path.join(DATA_DIR, "events.ndjson"), "utf8"))
      .trim()
      .split("\n")
      .slice(-150)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as LogEntry];
        } catch {
          return [];
        }
      });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function persistLog(entry: LogEntry): Promise<void> {
  await appendFile(
    path.join(DATA_DIR, "events.ndjson"),
    JSON.stringify(entry) + "\n",
    "utf8",
  );
}
