import { TaskOverviewSchema, type TaskOverview } from "../../shared/contracts/task-workspace.ts";
import type { PurchaseTaskDefinition } from "../../shared/contracts/purchase-task.ts";
import type { PurchaseStore } from "./purchase-store.ts";

export class TaskWorkspace {
  constructor(private readonly purchases: PurchaseStore) {}

  list(): TaskOverview[] {
    return this.purchases
      .listTasks()
      .map((task) => this.get(task.id))
      .sort((left, right) => right.task.createdAt.localeCompare(left.task.createdAt));
  }

  get(taskId: string): TaskOverview {
    return TaskOverviewSchema.parse({
      task: this.purchases.getTask(taskId),
      progress: this.purchases.progress(taskId),
    });
  }

  create(definition: PurchaseTaskDefinition): TaskOverview {
    return this.get(this.purchases.createTask(definition).id);
  }
}
