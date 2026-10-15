import type { BrowserState } from "../../../shared/contracts/browser.ts";

export { PLATFORM_LABELS, PLATFORM_MARKS } from "../../shared/platform-labels.ts";

export const CONNECTION_LABELS = {
  disconnected: "扩展未连接",
  connecting: "等待浏览器授权",
  connected: "扩展已连接",
  error: "扩展连接异常",
};

type Channel = BrowserState["channels"][number];

export function loginPresentation(channel: Channel | undefined) {
  if (!channel?.tab) return { label: "未检测", tone: "muted" };
  if (channel.login.reason === "stale") return { label: "待重新检测", tone: "warning" };
  if (channel.login.state === "logged_in") return { label: "已登录", tone: "ready" };
  if (channel.login.state === "logged_out") return { label: "需要登录", tone: "warning" };
  if (channel.login.reason === "verification") return { label: "待验证", tone: "warning" };
  return { label: "暂无法确认", tone: "muted" };
}
