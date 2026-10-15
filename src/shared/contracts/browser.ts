import { z } from "zod";
import { PLATFORMS } from "../../../shared/types.ts";

export const PlatformSchema = z.enum(PLATFORMS);
export const ChromeProfileSchema = z
  .string()
  .regex(/^(?:Default|Profile \d+)$/)
  .nullable();
export const ConnectBrowserSchema = z.strictObject({ profileDirectory: ChromeProfileSchema });
export const BrowserTabSchema = z.strictObject({ id: z.uuid(), title: z.string(), url: z.url() });
export const BindBrowserTabSchema = z.strictObject({ platform: PlatformSchema, tabId: z.uuid() });
export const LoginStatusSchema = z.strictObject({
  state: z.enum(["logged_in", "logged_out", "unknown"]),
  reason: z.enum([
    "authenticated",
    "login_required",
    "verification",
    "unrecognized",
    "unavailable",
    "browser_closed",
    "page_changed",
    "stale",
  ]),
  message: z.string(),
  checkedAt: z.iso.datetime().nullable(),
});
export const BrowserStateSchema = z.strictObject({
  connection: z.strictObject({
    phase: z.enum(["disconnected", "connecting", "connected", "error"]),
    message: z.string(),
    connectedAt: z.iso.datetime().nullable(),
  }),
  channels: z.array(
    z.strictObject({
      platform: PlatformSchema,
      tab: BrowserTabSchema.nullable(),
      login: LoginStatusSchema,
    }),
  ),
});

export const BrowserCommandSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("status") }),
  z.strictObject({ type: z.literal("connect"), input: ConnectBrowserSchema }),
  z.strictObject({ type: z.literal("disconnect") }),
  z.strictObject({ type: z.literal("list"), platform: PlatformSchema }),
  z.strictObject({ type: z.literal("bind"), input: BindBrowserTabSchema }),
  z.strictObject({ type: z.literal("refresh"), platform: PlatformSchema }),
  z.strictObject({ type: z.literal("focus"), platform: PlatformSchema }),
]);
export const BrowserResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("state"), value: BrowserStateSchema }),
  z.strictObject({ kind: z.literal("tabs"), value: z.array(BrowserTabSchema) }),
]);
export const BrowserRequestSchema = z.strictObject({ id: z.uuid(), command: BrowserCommandSchema });
export const BrowserWorkerMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("state"), value: BrowserStateSchema }),
  z.strictObject({ type: z.literal("result"), id: z.uuid(), result: BrowserResultSchema }),
  z.strictObject({ type: z.literal("error"), id: z.uuid(), message: z.string() }),
]);

export type BrowserState = z.infer<typeof BrowserStateSchema>;
export type BrowserCommand = z.infer<typeof BrowserCommandSchema>;
export type BrowserResult = z.infer<typeof BrowserResultSchema>;
export type ConnectBrowserInput = z.infer<typeof ConnectBrowserSchema>;
export type BindBrowserTabInput = z.infer<typeof BindBrowserTabSchema>;
export type BrowserTab = z.infer<typeof BrowserTabSchema>;
export type Platform = z.infer<typeof PlatformSchema>;
