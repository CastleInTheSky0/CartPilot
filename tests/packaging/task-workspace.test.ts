import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import type { Page } from "playwright";
import { launchDesktop } from "./desktop-fixture.ts";
import type {} from "../../src/renderer/env.d.ts";

async function fillBasics(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  await page.getByLabel("任务名称", { exact: true }).fill(name);
  await page.getByLabel("商品名称", { exact: true }).fill("通用跑鞋");
  await page.getByLabel("商品详情链接", { exact: true }).fill("https://item.jd.com/123.html");
  await page.getByLabel("每件最高价（元）", { exact: true }).fill("0.29");
  await page.getByLabel("任务总预算（元）", { exact: true }).fill("1.07");
  await page.getByLabel("开售时间", { exact: true }).fill("2026-10-16T20:00");
}

test(
  "桌面任务创建保留精确预算、显式授权、草稿与两种数量目标，重启不丢失",
  {
    timeout: 75_000,
  },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "cartpilot-task-workspace-"));
    let application = await launchDesktop(directory);
    try {
      let page = await application.firstWindow();
      await fillBasics(page, "跨平台跑鞋");
      assert.equal(await page.getByLabel("提交方式", { exact: true }).inputValue(), "");
      assert.equal(await page.getByLabel("允许减量并分多笔购买").isChecked(), false);
      await page.getByLabel("任务目标数量").fill("3");
      await page.getByLabel("单笔购买数量").fill("2");
      await page.getByRole("button", { name: "保存任务", exact: true }).click();
      assert.equal((await page.evaluate(() => window.cartPilot.listPurchaseTasks())).length, 0);
      await page.getByRole("button", { name: "浏览器连接", exact: true }).click();
      await page.getByRole("button", { name: "购买工作台", exact: true }).click();
      assert.equal(await page.getByLabel("任务名称", { exact: true }).inputValue(), "跨平台跑鞋");
      await page.getByRole("button", { name: "添加规格", exact: true }).click();
      await page.getByLabel("规格名称 1", { exact: true }).fill("尺码");
      await page.getByLabel("规格值 1", { exact: true }).fill("42");
      await page.getByRole("button", { name: "添加规格", exact: true }).click();
      await page.getByLabel("规格名称 2", { exact: true }).fill("尺码");
      await page.getByLabel("规格值 2", { exact: true }).fill("黑色");
      await page.getByLabel("提交方式", { exact: true }).selectOption("automatic");
      await page.getByRole("button", { name: "保存任务", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "规格名称不能重复" }).waitFor();
      await page.getByLabel("规格名称 2", { exact: true }).fill("颜色");
      await mkdir(resolve("output/playwright"), { recursive: true });
      await page.evaluate(() => window.scrollTo({ top: 0 }));
      await page.screenshot({ path: resolve("output/playwright/task-form.png"), fullPage: true });
      await page.getByRole("button", { name: "保存任务", exact: true }).click();
      await page.getByRole("region", { name: "任务详情", exact: true }).waitFor();
      const [first] = await page.evaluate(() => window.cartPilot.listPurchaseTasks());
      assert.equal(first.task.definition.budget.maxUnitPriceCents, 29);
      assert.equal(first.task.definition.budget.totalBudgetCents, 107);
      assert.equal(first.task.definition.submissionMode, "automatic");
      assert.equal(first.progress.confirmedQuantity, 0);
      assert.equal(first.progress.targetQuantity, 3);
      assert.deepEqual(first.task.definition.product.specifications, { 尺码: "42", 颜色: "黑色" });

      await fillBasics(page, "分平台跑鞋");
      await page.getByRole("button", { name: "添加候选", exact: true }).click();
      await page
        .getByRole("group", { name: "候选 2", exact: true })
        .getByLabel("商品详情链接", { exact: true })
        .fill("https://item.jd.com/789.html");
      await page.getByRole("button", { name: "添加候选", exact: true }).click();
      const third = page.getByRole("group", { name: "候选 3", exact: true });
      await third.getByLabel("平台", { exact: true }).selectOption("tmall");
      await third
        .getByLabel("商品详情链接", { exact: true })
        .fill("https://detail.tmall.com/item.htm?id=456");
      await page.getByLabel("数量模式", { exact: true }).selectOption("per_platform");
      await page.getByLabel("京东目标数量", { exact: true }).fill("2");
      await page.getByLabel("天猫目标数量", { exact: true }).fill("1");
      await page.getByLabel("允许减量并分多笔购买").check();
      await page.getByLabel("提交方式", { exact: true }).selectOption("manual");
      await page.getByRole("button", { name: "保存任务", exact: true }).click();
      await page.getByRole("heading", { name: "分平台跑鞋", exact: true }).waitFor();
      const before = await page.evaluate(() => window.cartPilot.listPurchaseTasks());
      assert.equal(before.length, 2);
      const second = before.find((item) => item.task.definition.name === "分平台跑鞋");
      assert.ok(second);
      assert.deepEqual(second.task.definition.quantityPlan, {
        mode: "per_platform",
        targets: [
          { platform: "jd", quantity: 2 },
          { platform: "tmall", quantity: 1 },
        ],
      });
      assert.equal(second.progress.targetQuantity, 3);
      assert.equal(second.task.definition.allowPartial, true);
      assert.equal(second.task.definition.submissionMode, "manual");
      const rejected = await page.evaluate(async (taskId) => {
        const { task } = await window.cartPilot.getPurchaseTask(taskId);
        Reflect.deleteProperty(task.definition, "submissionMode");
        try {
          await window.cartPilot.createPurchaseTask(task.definition);
          return false;
        } catch {
          return true;
        }
      }, first.task.id);
      assert.equal(rejected, true);
      assert.equal((await page.evaluate(() => window.cartPilot.listPurchaseTasks())).length, 2);
      await page.evaluate(() => window.scrollTo({ top: 0 }));
      await page.screenshot({
        path: resolve("output/playwright/task-workspace.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 760, height: 600 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.screenshot({
        path: resolve("output/playwright/task-workspace-narrow.png"),
        fullPage: true,
      });
      await application.close();
      application = await launchDesktop(directory);
      page = await application.firstWindow();
      await page.getByRole("button", { name: "分平台跑鞋", exact: true }).waitFor();
      assert.deepEqual(await page.evaluate(() => window.cartPilot.listPurchaseTasks()), before);
    } finally {
      await application.close();
    }
  },
);
