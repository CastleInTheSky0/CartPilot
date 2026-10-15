import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const EndpointSchema = z.strictObject({
  type: z.literal("endpoint"),
  endpoint: z.url(),
});

test(
  "官方中继在 IPv6 优先环境使用 IPv4 回环并接受真实 WebSocket 握手",
  { timeout: 20_000 },
  async () => {
    const runtime: unknown =
      process.env.CARTPILOT_EXECUTABLE ?? createRequire(import.meta.url)("electron");
    const executablePath = z.string().parse(runtime);
    const relayFile = process.env.CARTPILOT_EXECUTABLE
      ? join(dirname(executablePath), "resources/app.asar.unpacked/out/main/extension-relay.cjs")
      : resolve("out/main/extension-relay.cjs");
    const child = fork(
      fileURLToPath(new URL("../fixtures/relay-transport.cjs", import.meta.url)),
      [relayFile],
      {
        execPath: executablePath,
        execArgv: [],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        windowsHide: true,
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      },
    );
    let socket: WebSocket | undefined;
    try {
      const [input]: unknown[] = await once(child, "message", {
        signal: AbortSignal.timeout(10_000),
      });
      const { endpoint } = EndpointSchema.parse(input);
      const address = new URL(endpoint);
      assert.equal(address.protocol, "ws:");
      assert.equal(address.hostname, "127.0.0.1");
      assert.ok(address.port);
      socket = new WebSocket(endpoint);
      await new Promise<void>((resolveOpen, reject) => {
        const deadline = setTimeout(() => reject(new Error("本机中继握手超时。")), 5000);
        socket?.addEventListener(
          "open",
          () => {
            clearTimeout(deadline);
            resolveOpen();
          },
          { once: true },
        );
        socket?.addEventListener(
          "error",
          () => {
            clearTimeout(deadline);
            reject(new Error("本机中继拒绝 WebSocket 握手。"));
          },
          { once: true },
        );
      });
      assert.equal(socket.readyState, WebSocket.OPEN);
    } finally {
      socket?.close();
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit", { signal: AbortSignal.timeout(5000) });
        if (child.connected) child.send({ type: "stop" }, () => {});
        else child.kill();
        try {
          await exited;
        } finally {
          child.kill();
        }
      }
    }
  },
);
