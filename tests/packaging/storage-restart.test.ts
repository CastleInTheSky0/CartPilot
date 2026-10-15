import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { _electron } from "playwright";
import type {} from "../../src/renderer/env.d.ts";

test("Electron 原生 SQLite 完成迁移，重启保留设置且不重复迁移", { timeout: 45_000 }, async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "cartpilot-storage-"));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== "ELECTRON_RUN_AS_NODE") env[key] = value;
  }
  env.CARTPILOT_DATA_DIR = dataDirectory;
  const first = await _electron.launch({ args: [resolve(".")], env });
  let installationId: string;
  try {
    const page = await first.firstWindow();
    const runtime = await page.evaluate(() => window.cartPilot.getRuntimeInfo());
    installationId = runtime.storage.installationId;
    assert.equal(runtime.storage.schemaVersion, 1);
    assert.equal(runtime.storage.databasePath, join(dataDirectory, "cartpilot.sqlite"));
    assert.deepEqual(await page.evaluate(() => window.cartPilot.getBrowserPreferences()), {
      profileDirectory: null,
    });
    await page.evaluate(() =>
      window.cartPilot.connectBrowser({ profileDirectory: "Profile 999999999" }),
    );
    await page.getByText(/未找到官方扩展/).waitFor();
  } finally {
    await first.close();
  }

  const second = await _electron.launch({ args: [resolve(".")], env });
  try {
    const page = await second.firstWindow();
    const runtime = await page.evaluate(() => window.cartPilot.getRuntimeInfo());
    assert.equal(runtime.storage.installationId, installationId);
    assert.equal(runtime.storage.schemaVersion, 1);
    assert.equal(
      (await page.evaluate(() => window.cartPilot.getBrowserPreferences())).profileDirectory,
      "Profile 999999999",
    );
    assert.equal(
      (await page.evaluate(() => window.cartPilot.getBrowserState())).connection.phase,
      "disconnected",
    );
  } finally {
    await second.close();
  }
});
