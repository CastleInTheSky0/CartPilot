import { readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import electron from "electron";

const files = readdirSync("tests/integration")
  .filter((name) => name.endsWith(".test.ts"))
  .map((name) => `tests/integration/${name}`);
const child = spawn(electron, ["--import", "tsx", "--test", "--test-concurrency=1", ...files], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  stdio: "inherit",
  windowsHide: true,
});
child.once("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
