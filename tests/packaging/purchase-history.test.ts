import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { z } from "zod";
import { launchDesktop } from "./desktop-fixture.ts";
import type {} from "../../src/renderer/env.d.ts";

test(
  "桌面历史显示未支付与取消订单、未决占用和中断运行，可翻页且切换任务不串记录",
  {
    timeout: 60_000,
  },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "cartpilot-history-"));
    const runtime: unknown =
      process.env.CARTPILOT_EXECUTABLE ?? createRequire(import.meta.url)("electron");
    await promisify(execFile)(
      z.string().parse(runtime),
      ["--import", "tsx", resolve("tests/fixtures/seed-purchase-history.ts"), directory],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, windowsHide: true },
    );
    const application = await launchDesktop(directory);
    try {
      const page = await application.firstWindow();
      await page.getByRole("button", { name: "历史核对示例", exact: true }).click();
      await page.getByRole("button", { name: "查看运行与订单记录", exact: true }).click();
      const panel = page.getByRole("region", { name: "运行与订单历史", exact: true });
      await panel.getByText("history-unpaid", { exact: true }).waitFor();
      await panel.getByText("history-cancelled", { exact: true }).waitFor();
      await panel.getByRole("cell", { name: "待支付", exact: true }).waitFor();
      await panel.getByRole("cell", { name: "已取消", exact: true }).waitFor();
      const holds = panel.getByRole("table", { name: "待核对与预留", exact: true });
      assert.equal(await holds.getByRole("row").count(), 2);
      await holds.getByRole("cell", { name: "提交待核对", exact: true }).waitFor();
      assert.equal(await panel.getByRole("button", { name: /清除|重试提交|释放占用/ }).count(), 0);
      await panel.getByText(/运行记录 ·/).click();
      await panel.getByRole("cell", { name: "中断，待复核", exact: true }).waitFor();
      await panel.getByText(/事件记录 ·/).click();
      await panel.getByRole("button", { name: "加载更早记录", exact: true }).click();
      await panel.getByText("已在隔离订单页核对，未生成订单", { exact: true }).waitFor();
      assert.equal(
        await panel.getByRole("button", { name: "加载更早记录", exact: true }).count(),
        0,
      );
      await panel.getByText(/事件记录 ·/).click();
      await panel.getByText(/运行记录 ·/).click();
      await mkdir(resolve("output/playwright"), { recursive: true });
      await page.evaluate(() => window.scrollTo({ top: 0 }));
      await page.screenshot({
        path: resolve("output/playwright/purchase-history.png"),
        fullPage: true,
      });
      await page.getByRole("button", { name: "未运行任务", exact: true }).click();
      await page.getByRole("button", { name: "查看运行与订单记录", exact: true }).click();
      await panel.getByText("还没有已核对的有效订单。", { exact: true }).waitFor();
      assert.equal(await panel.getByText("history-unpaid", { exact: true }).count(), 0);
      const tasks = await page.evaluate(() => window.cartPilot.listPurchaseTasks());
      const task = tasks.find((item) => item.task.definition.name === "历史核对示例");
      assert.ok(task);
      assert.equal(task.progress.confirmedQuantity, 4);
      assert.equal(task.progress.heldQuantity, 6);
      assert.equal(task.progress.remainingBudgetCents, 157_000);
    } finally {
      await application.close();
    }
  },
);
