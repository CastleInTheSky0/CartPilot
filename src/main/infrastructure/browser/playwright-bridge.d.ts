declare module "playwright-core/lib/coreBundle" {
  import type { Browser } from "playwright";

  // Playwright 1.64.1 的内部导出；升级时须核对该签名及断开语义。
  export const tools: {
    createBrowserWithInfo(
      config: unknown,
      clientInfo: unknown,
      options: unknown,
      bind: unknown,
    ): Promise<{ browser: Browser; endpoint: string; ownership: string }>;
  };
}
