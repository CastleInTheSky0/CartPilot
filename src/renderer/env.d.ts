import type { DesktopApi } from "../shared/contracts/desktop.ts";

declare global {
  interface Window {
    cartPilot: DesktopApi;
  }
}
