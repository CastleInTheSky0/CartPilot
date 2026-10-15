import { randomUUID } from "node:crypto";
import { app, utilityProcess, type UtilityProcess } from "electron";
import { join } from "node:path";
import {
  BrowserWorkerMessageSchema,
  type BrowserCommand,
  type BrowserResult,
  type BrowserState,
} from "../../../shared/contracts/browser.ts";

type PendingRequest = {
  resolve(result: BrowserResult): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};

export class BrowserWorkerClient {
  private child: UtilityProcess | null = null;
  private pending = new Map<string, PendingRequest>();
  private listeners = new Set<(state: BrowserState) => void>();
  private closed = false;

  subscribe(listener: (state: BrowserState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async execute(command: BrowserCommand): Promise<BrowserResult> {
    if (this.closed) throw new Error("浏览器工作进程已关闭。");
    const child = this.child ?? this.start();
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("浏览器操作超时，请重新连接。"));
      }, 20_000);
      this.pending.set(id, { resolve, reject, timer });
      child.postMessage({ id, command });
    });
  }

  async dispose(): Promise<void> {
    if (this.closed) return;
    const child = this.child;
    try {
      if (child) await this.execute({ type: "disconnect" });
    } finally {
      this.closed = true;
      child?.kill();
      this.child = null;
      this.rejectPending("浏览器工作进程已关闭。");
      this.listeners.clear();
    }
  }

  private start(): UtilityProcess {
    const directory = app.isPackaged
      ? join(process.resourcesPath, "app.asar.unpacked/out/main")
      : join(__dirname);
    const child = utilityProcess.fork(join(directory, "browser-worker.cjs"), [], {
      serviceName: "CartPilot 浏览器连接",
      stdio: "ignore",
    });
    child.on("message", (input: unknown) => {
      const parsed = BrowserWorkerMessageSchema.safeParse(input);
      if (!parsed.success) {
        this.rejectPending("浏览器工作进程返回了无效消息。");
        return;
      }
      const message = parsed.data;
      if (message.type === "state") {
        for (const listener of this.listeners) listener(message.value);
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.type === "error") pending.reject(new Error(message.message));
      else pending.resolve(message.result);
    });
    child.once("exit", () => {
      if (this.child !== child) return;
      this.child = null;
      this.rejectPending("浏览器工作进程已退出，请重新连接。");
      for (const listener of this.listeners)
        listener({
          connection: {
            phase: "error",
            message: "浏览器工作进程已退出，请重新连接。",
            connectedAt: null,
          },
          channels: [],
        });
    });
    this.child = child;
    return child;
  }

  private rejectPending(message: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }
}
