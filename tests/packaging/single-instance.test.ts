import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { launchDesktop } from "./desktop-fixture.ts";

test("同一数据目录的第二实例退出，原实例继续运行", { timeout: 30_000 }, async () => {
  const dataDirectory = join(await mkdtemp(join(tmpdir(), "cartpilot-instance-")), "new-user-data");
  const first = await launchDesktop(dataDirectory);
  try {
    const page = await first.firstWindow();
    const env: NodeJS.ProcessEnv = { ...process.env, CARTPILOT_DATA_DIR: dataDirectory };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(
      first.process().spawnfile,
      process.env.CARTPILOT_EXECUTABLE ? [] : [resolve(".")],
      { env, windowsHide: true, stdio: "ignore" },
    );
    const exitCode = await new Promise<number | null>((resolveExit, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error("第二实例未及时退出。"));
      }, 10_000);
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        resolveExit(code);
      });
    });
    assert.equal(exitCode, 0);
    assert.equal(first.windows().length, 1);
    await page.getByRole("heading", { name: "先连接你的日常浏览器" }).waitFor();
  } finally {
    await first.close();
  }
});
