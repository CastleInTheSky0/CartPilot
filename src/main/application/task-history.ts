import { z } from "zod";
import {
  TaskHistoryQuerySchema,
  TaskHistorySchema,
  type TaskHistory,
  type TaskHistoryQuery,
} from "../../shared/contracts/purchase-history.ts";
import { PurchaseError } from "../domain/purchase-error.ts";
import type { PurchaseStore } from "./purchase-store.ts";

export class TaskHistoryReader {
  constructor(private readonly purchases: PurchaseStore) {}

  read(input: TaskHistoryQuery): TaskHistory {
    const { taskId, beforeSequence } = TaskHistoryQuerySchema.parse(input);
    const intents = this.purchases.listIntents(taskId);
    const intentById = new Map(intents.map((intent) => [intent.id, intent]));
    const events = this.purchases.listEvents(taskId, beforeSequence);
    return TaskHistorySchema.parse({
      taskId,
      runs: this.purchases.listRuns(taskId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      intents: intents.map(
        ({ evidence: _evidence, resources: _resources, taskId: _taskId, ...item }) => item,
      ),
      orders: this.purchases
        .listOrders(taskId)
        .map((order) => {
          const intent = intentById.get(order.intentId);
          if (!intent || intent.status !== "confirmed" || intent.platform !== order.platform)
            throw new PurchaseError("corrupt_record", "订单与购买意图不一致，请核对存储记录。");
          return {
            id: order.id,
            intentId: order.intentId,
            platform: order.platform,
            orderNumber: order.orderNumber,
            quantity: intent.quantity,
            amountCents: intent.amountCents,
            paymentStatus: order.paymentStatus,
            createdAt: order.createdAt,
          };
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      events: events.items.map((event) => {
        const detail = z.object({ reason: z.string().max(1000) }).safeParse(event.detail);
        return {
          sequence: event.sequence,
          intentId: event.intentId,
          type: event.type,
          at: event.at,
          reason:
            (event.type === "no_order_verified" || event.type === "restriction_reviewed") &&
            detail.success
              ? detail.data.reason
              : null,
        };
      }),
      nextBeforeSequence: events.nextBeforeSequence,
    });
  }
}
