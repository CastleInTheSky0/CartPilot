import type { ExecutionOutcome, PreparedTask } from "../../shared/contracts/task-execution.ts";
import type { PurchaseRun } from "../../shared/contracts/purchase-order.ts";
import type { PurchaseTask } from "../../shared/contracts/purchase-task.ts";

export interface TaskPreparationPort {
  prepare(task: PurchaseTask, signal: AbortSignal): Promise<PreparedTask>;
}

export interface TaskExecutionPort {
  execute(
    task: PurchaseTask,
    run: PurchaseRun,
    plan: PreparedTask,
    signal: AbortSignal,
  ): Promise<ExecutionOutcome>;
}
