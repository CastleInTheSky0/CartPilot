import { join } from "node:path";
import { BrowserRequestSchema } from "../../shared/contracts/browser.ts";
import { ExtensionService } from "../infrastructure/browser/extension-service.ts";
import { createOfficialConnector } from "../infrastructure/browser/official-connector.ts";

const port = process.parentPort;
if (!port) throw new Error("浏览器工作进程缺少父进程端口。");
const service = new ExtensionService(
  createOfficialConnector({
    relayFile: join(__dirname, "extension-relay.cjs"),
    runAsNode: true,
  }),
  (value) => port.postMessage({ type: "state", value }),
);

port.on("message", (event) => {
  const parsed = BrowserRequestSchema.safeParse(event.data);
  if (!parsed.success) return;
  const { id, command } = parsed.data;
  void service.execute(command).then(
    (result) => port.postMessage({ type: "result", id, result }),
    (error: unknown) =>
      port.postMessage({
        type: "error",
        id,
        message: error instanceof Error ? error.message : "浏览器操作失败，请重试。",
      }),
  );
});
process.on("SIGTERM", () => {
  void service.dispose().finally(() => process.exit(0));
});
