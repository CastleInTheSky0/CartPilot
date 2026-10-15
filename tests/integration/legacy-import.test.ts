import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { defaultPlan, defaultWorkspace } from "../../shared/types.ts";
import { LegacyImportRequestSchema } from "../../src/shared/contracts/legacy-import.ts";
import { openDesktopStore } from "../../src/main/infrastructure/storage/desktop-store.ts";
import { reservation, storageFixture } from "./purchase-storage-fixture.ts";

async function legacyFixture(context: TestContext) {
  const fixture = storageFixture(context, { orderQuantity: 1 });
  fixture.purchases.stopRun(fixture.run.id);
  const source = join(fixture.directory, "legacy-source");
  await mkdir(source);
  const plan = {
    ...defaultPlan("jd"),
    productUrl: "https://item.jd.com/123.html",
    backupProductUrl: "https://item.jd.com/124.html",
  };
  const workspace = defaultWorkspace(plan);
  workspace.mode = "race";
  workspace.enabledPlatforms = ["jd", "tmall"];
  workspace.plans.tmall = {
    ...plan,
    platform: "tmall",
    productUrl: "https://detail.tmall.com/item.htm?id=456",
    backupProductUrl: "",
  };
  await writeFile(join(source, "workspace.json"), JSON.stringify(workspace));
  await writeFile(join(source, "events.ndjson"), '{"message":"旧运行日志"}\n');
  await writeFile(
    join(source, "browser-connection.json"),
    JSON.stringify({ version: 1, mode: "managed", profileDirectory: "Default" }),
  );
  return {
    ...fixture,
    source,
    workspace,
    request: { sourceDirectory: source, sourceStopped: true as const },
  };
}

test("旧多平台目标仍为合计一件，备份保留原文件且重复迁移不重复创建任务", async (context) => {
  const { store, purchases, source, request, directory } = await legacyFixture(context);
  const before = await readFile(join(source, "workspace.json"));
  const imported = await store.legacy.importDirectory(request);
  assert.deepEqual(imported.issues, []);
  assert.ok(imported.taskId);
  const task = purchases.getTask(imported.taskId);
  assert.deepEqual(task.definition.quantityPlan, { mode: "total", targetQuantity: 1 });
  assert.equal(task.definition.orderQuantity, 1);
  assert.equal(task.definition.candidates.length, 3);
  assert.equal(task.definition.submissionMode, "manual");
  assert.equal(task.definition.budget.totalBudgetCents, 1_599_900);
  assert.equal(purchases.progress(task.id).confirmedQuantity, 0);
  assert.deepEqual(await readFile(join(source, "workspace.json")), before);
  assert.deepEqual(await readFile(join(imported.backupDirectory, "workspace.json")), before);
  assert.equal(
    await readFile(join(imported.backupDirectory, "events.ndjson"), "utf8"),
    '{"message":"旧运行日志"}\n',
  );
  assert.deepEqual(store.readBrowserPreferences(), { profileDirectory: null });
  assert.equal((await store.legacy.importDirectory(request)).taskId, task.id);
  assert.equal(purchases.listTasks().length, 2);
  const restoreDirectory = join(directory, "restore-verification");
  await mkdir(restoreDirectory);
  await copyFile(
    join(imported.backupDirectory, "desktop-before-import.sqlite"),
    join(restoreDirectory, "cartpilot.sqlite"),
  );
  const restored = openDesktopStore(restoreDirectory, resolve("migrations"));
  try {
    assert.equal(restored.purchases.listTasks().length, 1);
    assert.deepEqual(restored.legacy.listImports(), []);
  } finally {
    restored.close();
  }
});

for (const result of ["unknown", "confirmed"] as const) {
  test(`旧 ${result} 提交即使曾解除重试锁，也保留全局核对阻塞并跨重启生效`, async (context) => {
    const { store, purchases, source, request, task, directory } = await legacyFixture(context);
    await writeFile(
      join(source, "submission.json"),
      JSON.stringify({
        runId: "legacy-run",
        at: new Date().toISOString(),
        fingerprint: "旧商品",
        result,
        resolved: true,
      }),
    );
    const record = await store.legacy.importDirectory(request);
    assert.equal(record.issues.length, 1);
    assert.throws(() => purchases.startRun(task.id), { code: "legacy_review_required" });
    store.close();
    const reopened = openDesktopStore(directory, resolve("migrations"));
    try {
      assert.throws(() => reopened.purchases.startRun(task.id), { code: "legacy_review_required" });
      assert.equal(reopened.legacy.listImports()[0].issues.length, 1);
    } finally {
      reopened.close();
    }
  });
}

test("旧渠道配置不一致时不猜测规格或预算，保留备份和冲突原因", async (context) => {
  const { store, purchases, source, workspace, request, task } = await legacyFixture(context);
  workspace.plans.tmall.maxTotal = 1000;
  await writeFile(join(source, "workspace.json"), JSON.stringify(workspace));
  const record = await store.legacy.importDirectory(request);
  assert.equal(record.taskId, null);
  assert.match(record.issues[0], /预算/);
  assert.equal(purchases.listTasks().length, 1);
  assert.throws(() => purchases.startRun(task.id), { code: "legacy_review_required" });
});

test("冷却记录共享淘宝天猫，期限过后仍须明确核对，重启不清除", async (context) => {
  const { store, task, source, request, directory } = await legacyFixture(context);
  await writeFile(
    join(source, "access-state.json"),
    JSON.stringify({
      version: 1,
      restrictions: { taobao: { until: "2020-01-01T00:00:00Z", status: 429, message: "历史限流" } },
    }),
  );
  await store.legacy.importDirectory(request);
  store.close();
  const reopened = openDesktopStore(directory, resolve("migrations"));
  try {
    const run = reopened.purchases.startRun(task.id);
    assert.equal(reopened.legacy.readRestrictions().length, 1);
    assert.throws(() => reopened.purchases.reserve(reservation(task, run.id, 1)), {
      code: "access_restricted",
    });
    reopened.legacy.acknowledgeRestriction(task.id, "tmall", "已检查真实页面，验证已解除");
    assert.equal(reopened.legacy.readRestrictions().length, 0);
    reopened.purchases.reserve(reservation(task, run.id, 1));
  } finally {
    reopened.close();
  }
});

test("冷却未结束不能解除，导入时不覆盖更长的已有冷却", async (context) => {
  const { store, task, source, request } = await legacyFixture(context);
  const until = new Date(Date.now() + 600_000).toISOString();
  await writeFile(
    join(source, "access-state.json"),
    JSON.stringify({
      version: 1,
      restrictions: { jd: { until, status: 403, message: "需人工检查" } },
    }),
  );
  await store.legacy.importDirectory(request);
  assert.throws(() => store.legacy.acknowledgeRestriction(task.id, "jd", "已检查"), {
    code: "cooldown_active",
  });
  const otherSource = join(source, "second-source");
  await mkdir(otherSource);
  await copyFile(join(source, "workspace.json"), join(otherSource, "workspace.json"));
  await writeFile(
    join(otherSource, "access-state.json"),
    JSON.stringify({
      version: 1,
      restrictions: { jd: { until: "2020-01-01T00:00:00Z", status: 429, message: "更短冷却" } },
    }),
  );
  await store.legacy.importDirectory({ sourceDirectory: otherSource, sourceStopped: true });
  assert.equal(store.legacy.readRestrictions()[0].until, until);
});

test("已导入来源变化不会创建重复目标，运行期间不混合迁移", async (context) => {
  const { store, purchases, task, request, source } = await legacyFixture(context);
  assert.equal(
    LegacyImportRequestSchema.safeParse({ ...request, sourceStopped: false }).success,
    false,
  );
  const run = purchases.startRun(task.id);
  await assert.rejects(store.legacy.importDirectory(request), { code: "migration_requires_stop" });
  purchases.stopRun(run.id);
  await store.legacy.importDirectory(request);
  await writeFile(join(source, "events.ndjson"), "新事件\n");
  await assert.rejects(store.legacy.importDirectory(request), { code: "legacy_source_changed" });
  assert.equal(purchases.listTasks().length, 2);
});

test("损坏的旧提交和冷却文件不静默丢弃，原始字节仍可从备份恢复", async (context) => {
  const { store, purchases, task, source, request } = await legacyFixture(context);
  const bytes = Buffer.from([0xff, 0xfe, 0x00, 0x7b]);
  await writeFile(join(source, "submission.json"), bytes);
  await writeFile(join(source, "access-state.json"), "{invalid");
  const record = await store.legacy.importDirectory(request);
  assert.equal(record.issues.length, 2);
  assert.deepEqual(await readFile(join(record.backupDirectory, "submission.json")), bytes);
  assert.throws(() => purchases.startRun(task.id), { code: "legacy_review_required" });
});
