import type { BrowserWindow } from "electron";
import { z } from "zod";
import { DESKTOP_CHANNELS } from "../../shared/contracts/desktop.ts";
import { PurchaseTaskDefinitionSchema } from "../../shared/contracts/purchase-task.ts";
import { TaskWorkspace } from "../application/task-workspace.ts";
import { TaskHistoryReader } from "../application/task-history.ts";
import { TaskHistoryQuerySchema } from "../../shared/contracts/purchase-history.ts";
import type { PurchaseStore } from "../application/purchase-store.ts";
import { registerValidatedHandler } from "./validated-handler.ts";

export function registerTaskIpc(
  window: BrowserWindow,
  rendererUrl: string,
  purchases: PurchaseStore,
): void {
  const workspace = new TaskWorkspace(purchases);
  const history = new TaskHistoryReader(purchases);
  registerValidatedHandler(
    window,
    rendererUrl,
    DESKTOP_CHANNELS.taskHistory,
    TaskHistoryQuerySchema,
    (query) => history.read(query),
  );
  registerValidatedHandler(window, rendererUrl, DESKTOP_CHANNELS.taskList, z.undefined(), () =>
    workspace.list(),
  );
  registerValidatedHandler(window, rendererUrl, DESKTOP_CHANNELS.taskGet, z.uuid(), (taskId) =>
    workspace.get(taskId),
  );
  registerValidatedHandler(
    window,
    rendererUrl,
    DESKTOP_CHANNELS.taskCreate,
    PurchaseTaskDefinitionSchema,
    (definition) => workspace.create(definition),
  );
}
