import assert from "node:assert/strict";
import test from "node:test";
import { PurchaseTaskDefinitionSchema } from "../../src/shared/contracts/purchase-task.ts";
import {
  purchaseProgress,
  reservationQuantity,
  type PurchaseUsage,
} from "../../src/main/domain/purchase-progress.ts";
import { purchaseDefinition } from "./purchase-fixture.ts";

test("通用商品保留任意规格，减量默认关闭，提交方式必须显式选择", () => {
  const definition = purchaseDefinition();
  assert.deepEqual(definition.product.specifications, { 尺码: "42", 颜色: "黑色" });
  assert.equal(definition.allowPartial, false);
  const { submissionMode, ...missingMode } = definition;
  assert.equal(PurchaseTaskDefinitionSchema.safeParse(missingMode).success, false);
  for (const field of ["orderQuantity", "budget", "schedule"]) {
    assert.equal(
      PurchaseTaskDefinitionSchema.safeParse({ ...definition, [field]: null }).success,
      false,
    );
  }
  assert.equal(
    PurchaseTaskDefinitionSchema.safeParse({ ...definition, extraPermission: true }).success,
    false,
  );
});

test("任务拒绝重复候选、重复平台配额、缺少平台配额和不精确金额", () => {
  const definition = purchaseDefinition();
  const invalid = [
    { candidates: [definition.candidates[0], definition.candidates[0]] },
    { quantityPlan: { mode: "per_platform", targets: [{ platform: "jd", quantity: 1 }] } },
    {
      quantityPlan: {
        mode: "per_platform",
        targets: [
          { platform: "jd", quantity: 1 },
          { platform: "jd", quantity: 1 },
        ],
      },
    },
    { orderQuantity: 1.5 },
    { budget: { ...definition.budget, maxUnitPriceCents: 1.5 } },
    { budget: { ...definition.budget, totalBudgetCents: Number.MAX_SAFE_INTEGER + 1 } },
    { schedule: { ...definition.schedule, launchAt: "2026-10-16T20:00:00" } },
  ];
  for (const input of invalid)
    assert.equal(
      PurchaseTaskDefinitionSchema.safeParse({ ...definition, ...input }).success,
      false,
    );
});

test("合计配额按件累计，预留和未决占用配额，默认不把最后一笔减量", () => {
  const task = purchaseDefinition();
  const usage: PurchaseUsage[] = [
    { platform: "jd", quantity: 2, amountCents: 80_000, status: "confirmed" },
  ];
  assert.equal(purchaseProgress(task, usage).confirmedQuantity, 2);
  assert.throws(() => reservationQuantity(task, "tmall", usage, 10), { code: "partial_disabled" });
  assert.equal(reservationQuantity({ ...task, allowPartial: true }, "tmall", usage, 10), 1);
  usage.push({ platform: "tmall", quantity: 1, amountCents: 40_000, status: "pending" });
  assert.throws(() => reservationQuantity(task, "jd", usage, 10), { code: "quota_exhausted" });
  assert.equal(purchaseProgress(task, usage).isComplete, false);
  usage[1].status = "confirmed";
  assert.equal(purchaseProgress(task, usage).isComplete, true);
});

test("分平台共享本平台配额，同时所有平台共享任务总预算", () => {
  const task = purchaseDefinition({
    quantityPlan: {
      mode: "per_platform",
      targets: [
        { platform: "jd", quantity: 2 },
        { platform: "tmall", quantity: 1 },
      ],
    },
    orderQuantity: 1,
  });
  const usage: PurchaseUsage[] = [
    { platform: "jd", quantity: 2, amountCents: 90_000, status: "confirmed" },
  ];
  assert.throws(() => reservationQuantity(task, "jd", usage, 5), { code: "quota_exhausted" });
  assert.equal(reservationQuantity(task, "tmall", usage, 5), 1);
  assert.equal(purchaseProgress(task, usage).remainingBudgetCents, 60_000);
  usage.push({ platform: "tmall", quantity: 1, amountCents: 45_000, status: "reserved" });
  assert.equal(purchaseProgress(task, usage).remainingBudgetCents, 15_000);
  assert.equal(purchaseProgress(task, usage).isComplete, false);
});

test("库存和限购不足时遵守减量开关，已释放预留不再占用", () => {
  const task = purchaseDefinition();
  assert.throws(() => reservationQuantity(task, "jd", [], 1), { code: "partial_disabled" });
  assert.equal(reservationQuantity({ ...task, allowPartial: true }, "jd", [], 1), 1);
  assert.throws(() => reservationQuantity(task, "jd", [], 0), { code: "unavailable" });
  assert.equal(
    purchaseProgress(task, [
      { platform: "jd", quantity: 3, amountCents: 150_000, status: "released" },
    ]).heldCents,
    0,
  );
});

test("候选只接受对应平台商品页并去除跟踪参数，Apple 不再绑定手机型号", () => {
  const task = purchaseDefinition();
  const candidate = task.candidates[0];
  for (const productUrl of [
    "https://jd.com.evil.example/123.html",
    "https://passport.jd.com/new/login.aspx",
    "https://item.jd.com:8443/123.html",
    "https://user:secret@item.jd.com/123.html",
  ])
    assert.equal(
      PurchaseTaskDefinitionSchema.safeParse({
        ...task,
        candidates: [{ ...candidate, productUrl }],
      }).success,
      false,
    );
  const normalized = purchaseDefinition({
    candidates: [
      { ...candidate, productUrl: "https://item.jd.com/123.html?tracking=private#fragment" },
    ],
  });
  assert.equal(normalized.candidates[0].productUrl, "https://item.jd.com/123.html");
  const apple = purchaseDefinition({
    candidates: [
      {
        ...candidate,
        platform: "apple",
        productUrl: "https://www.apple.com.cn/shop/buy-mac/macbook-air",
      },
    ],
  });
  assert.equal(apple.candidates[0].platform, "apple");
});

test("规格键在标准化前拒绝覆盖和歧义，不能通过首尾空白静默改写目标", () => {
  const task = purchaseDefinition();
  for (const specifications of [
    { 颜色: "黑色", " 颜色 ": "白色" },
    { Size: "42", Ｓize: "43" },
    { "尺 码": "42", 尺码: "43" },
    { "\u200b": "无名称" },
  ]) {
    assert.equal(
      PurchaseTaskDefinitionSchema.safeParse({
        ...task,
        product: { ...task.product, specifications },
      }).success,
      false,
    );
  }
});

test("候选商品和 SKU 编号必须与详情链接中明确的身份一致", () => {
  const task = purchaseDefinition();
  assert.equal(
    PurchaseTaskDefinitionSchema.safeParse({
      ...task,
      candidates: [{ ...task.candidates[0], productId: "999" }],
    }).success,
    false,
  );
  assert.equal(
    PurchaseTaskDefinitionSchema.safeParse({
      ...task,
      candidates: [
        {
          ...task.candidates[1],
          productUrl: "https://detail.tmall.com/item.htm?id=456&skuId=100",
          skuId: "200",
        },
      ],
    }).success,
    false,
  );
});
