import { resolve } from "node:path";
import { _electron, type ElectronApplication } from "playwright";

export async function launchDesktop(dataDirectory: string): Promise<ElectronApplication> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !["ELECTRON_RUN_AS_NODE", "ELECTRON_RENDERER_URL"].includes(key))
      env[key] = value;
  }
  env.CARTPILOT_DATA_DIR = dataDirectory;
  const executablePath = process.env.CARTPILOT_EXECUTABLE;
  const application = await _electron.launch({
    executablePath,
    args: executablePath ? [] : [resolve(".")],
    env,
    timeout: 20_000,
  });
  application.context().setDefaultTimeout(15_000);
  return application;
}
