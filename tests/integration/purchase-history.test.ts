import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { TaskHistoryReader } from "../../src/main/application/task-history.ts";
import { createHistoryScenario } from "./purchase-history-fixture.ts";
import { storageFixture } from "./purchase-storage-fixture.ts";

test("历史按任务读取真实订单和未知占用，恢复中断不会清除未决或返回浏览器资源", (context) => {
  const { purchases } = storageFixture(context);
  const { task, pending, interrupted, reservationToRelease, untouched } =
    createHistoryScenario(purchases);
  purchases.recoverInterruptedRuns();
  const reader = new TaskHistoryReader(purchases);
  const history = reader.read({ taskId: task.id });
  assert.equal(history.orders.length, 2);
  assert.equal(
    history.orders.find((order) => order.orderNumber === "history-cancelled")?.paymentStatus,
    "cancelled",
  );
  assert.equal(history.orders.find((order) => order.orderNumber === "history-unpaid")?.quantity, 2);
  assert.equal(
    history.orders.find((order) => order.orderNumber === "history-unpaid")?.amountCents,
    81_000,
  );
  assert.equal(history.intents.find((intent) => intent.id === pending.id)?.status, "pending");
  assert.equal(
    history.intents.find((intent) => intent.id === reservationToRelease.id)?.status,
    "released",
  );
  assert.equal(history.runs.find((run) => run.id === interrupted.id)?.status, "interrupted");
  assert.equal(purchases.progress(task.id).heldQuantity, 6);
  assert.equal(purchases.progress(task.id).heldCents, 243_000);
  assert.equal(history.events[0].type, "run_interrupted");
  assert.ok(history.orders.every((order) => !("evidence" in order)));
  assert.ok(history.intents.every((intent) => !("evidence" in intent) && !("resources" in intent)));
  assert.equal(JSON.stringify(history).includes("default-profile"), false);
  const empty = reader.read({ taskId: untouched.id });
  assert.equal(empty.orders.length, 0);
  assert.equal(empty.runs.length, 0);
  assert.equal(empty.intents.length, 0);
  assert.deepEqual(
    empty.events.map((event) => event.type),
    ["task_created"],
  );
  assert.throws(() => reader.read({ taskId: randomUUID() }), /不存在/);
  assert.throws(() => reader.read({ taskId: task.id, beforeSequence: -1 }));
});

test("事件分页按持久化序号读取全部旧记录，不重复且保留人工核对理由", (context) => {
  const { purchases } = storageFixture(context);
  const { task } = createHistoryScenario(purchases);
  const reader = new TaskHistoryReader(purchases);
  const first = reader.read({ taskId: task.id });
  assert.equal(first.events.length, 50);
  assert.ok(first.nextBeforeSequence);
  const earlier = reader.read({ taskId: task.id, beforeSequence: first.nextBeforeSequence });
  assert.equal(earlier.nextBeforeSequence, null);
  const boundary = first.events.at(-1);
  assert.ok(boundary);
  assert.ok(earlier.events.every((event) => event.sequence < boundary.sequence));
  const events = [...first.events, ...earlier.events];
  assert.equal(new Set(events.map((event) => event.sequence)).size, events.length);
  assert.equal(events.at(-1)?.type, "task_created");
  assert.equal(events.filter((event) => event.type === "order_confirmed").length, 2);
  assert.equal(
    events.find((event) => event.type === "no_order_verified")?.reason,
    "已在隔离订单页核对，未生成订单",
  );
  assert.ok(events.every((event) => !("detail" in event)));
});
