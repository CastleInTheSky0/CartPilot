import { isAbsolute, resolve } from "node:path";
import { openDesktopStore } from "../../src/main/infrastructure/storage/desktop-store.ts";
import { createHistoryScenario } from "../integration/purchase-history-fixture.ts";

const directory = process.argv[2];
if (!directory || !isAbsolute(directory)) throw new Error("测试数据目录必须是绝对路径。");
const store = openDesktopStore(directory, resolve("migrations"));
try {
  createHistoryScenario(store.purchases);
} finally {
  store.close();
}
