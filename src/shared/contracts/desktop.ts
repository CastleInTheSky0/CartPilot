import { z } from "zod";

export const DESKTOP_CHANNELS = { runtime: "desktop:runtime" } as const;

export const RuntimeInfoSchema = z.strictObject({
  version: z.string(),
  electron: z.string(),
  chromium: z.string(),
  node: z.string(),
  dataDirectory: z.string(),
  isPackaged: z.boolean(),
});

export type RuntimeInfo = z.infer<typeof RuntimeInfoSchema>;

export interface DesktopApi {
  getRuntimeInfo(): Promise<RuntimeInfo>;
}
