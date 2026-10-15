import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { TestContext } from "node:test";
import type {
  CheckoutEvidence,
  ReservePurchase,
} from "../../src/shared/contracts/purchase-order.ts";
import type {
  PurchaseTask,
  PurchaseTaskDefinition,
} from "../../src/shared/contracts/purchase-task.ts";
import { openDesktopStore } from "../../src/main/infrastructure/storage/desktop-store.ts";
import { purchaseDefinition } from "../unit/purchase-fixture.ts";

export function storageFixture(
  context: TestContext,
  overrides: Partial<PurchaseTaskDefinition> = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "cartpilot-purchases-"));
  const store = openDesktopStore(directory, resolve("migrations"));
  context.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const task = store.purchases.createTask(purchaseDefinition(overrides));
  const run = store.purchases.startRun(task.id);
  return { directory, store, purchases: store.purchases, task, run };
}

export function checkoutEvidence(
  task: PurchaseTask,
  index = 0,
  overrides: Partial<CheckoutEvidence> = {},
): CheckoutEvidence {
  return {
    productId: task.definition.candidates[index].productId ?? "unidentified",
    skuId: task.definition.candidates[index].skuId,
    specifications: task.definition.product.specifications,
    seller: "品牌旗舰店",
    quantity: task.definition.orderQuantity,
    itemCount: 1,
    unitPriceCents: 40_000,
    payableTotalCents: 40_000 * task.definition.orderQuantity + 1000,
    shippingIncluded: true,
    isCheckout: true,
    orderKind: "full_payment",
    observedAt: new Date().toISOString(),
    ...overrides,
  };
}

export function reservation(
  task: PurchaseTask,
  runId: string,
  index = 0,
  overrides: Partial<ReservePurchase> = {},
): ReservePurchase {
  return {
    intentId: randomUUID(),
    runId,
    candidateId: task.definition.candidates[index].id,
    availableQuantity: 10,
    evidence: checkoutEvidence(task, index),
    resources: {
      browserSessionId: randomUUID(),
      tabId: randomUUID(),
      profileId: "default-profile",
    },
    ...overrides,
  };
}
