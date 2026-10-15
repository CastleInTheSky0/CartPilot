import { z } from "zod";
import { StorageStatusSchema } from "./storage.ts";
import type { PurchaseTaskDefinition } from "./purchase-task.ts";
import type { TaskOverview } from "./task-workspace.ts";
import type { TaskHistory, TaskHistoryQuery } from "./purchase-history.ts";
import type {
  BindBrowserTabInput,
  BrowserState,
  BrowserTab,
  ConnectBrowserInput,
  Platform,
} from "./browser.ts";

export const DESKTOP_CHANNELS = {
  runtime: "desktop:runtime",
  browserState: "browser:state",
  browserPreferences: "browser:preferences",
  browserConnect: "browser:connect",
  browserDisconnect: "browser:disconnect",
  browserListTabs: "browser:list-tabs",
  browserBindTab: "browser:bind-tab",
  browserRefreshLogin: "browser:refresh-login",
  browserFocusTab: "browser:focus-tab",
  browserInstall: "browser:install",
  browserChanged: "browser:changed",
  taskList: "tasks:list",
  taskGet: "tasks:get",
  taskCreate: "tasks:create",
  taskHistory: "tasks:history",
} as const;

export const RuntimeInfoSchema = z.strictObject({
  version: z.string(),
  electron: z.string(),
  chromium: z.string(),
  node: z.string(),
  dataDirectory: z.string(),
  isPackaged: z.boolean(),
  storage: StorageStatusSchema,
});

export type RuntimeInfo = z.infer<typeof RuntimeInfoSchema>;

export interface DesktopApi {
  getRuntimeInfo(): Promise<RuntimeInfo>;
  listPurchaseTasks(): Promise<TaskOverview[]>;
  getPurchaseTask(taskId: string): Promise<TaskOverview>;
  createPurchaseTask(definition: PurchaseTaskDefinition): Promise<TaskOverview>;
  getPurchaseTaskHistory(query: TaskHistoryQuery): Promise<TaskHistory>;
  getBrowserState(): Promise<BrowserState>;
  getBrowserPreferences(): Promise<ConnectBrowserInput>;
  connectBrowser(input: ConnectBrowserInput): Promise<BrowserState>;
  disconnectBrowser(): Promise<BrowserState>;
  listBrowserTabs(platform: Platform): Promise<BrowserTab[]>;
  bindBrowserTab(input: BindBrowserTabInput): Promise<BrowserState>;
  refreshBrowserLogin(platform: Platform): Promise<BrowserState>;
  focusBrowserTab(platform: Platform): Promise<BrowserState>;
  openExtensionInstall(): Promise<void>;
  onBrowserStateChanged(listener: (state: BrowserState) => void): () => void;
}
