import type { BrowserState } from "../../../shared/contracts/browser.ts";

export const PLATFORM_LABELS = {
  apple: "Apple 中国官网",
  taobao: "淘宝",
  tmall: "天猫",
  jd: "京东",
  douyin: "抖音商城",
};

export const PLATFORM_MARKS = { apple: "A", taobao: "淘", tmall: "猫", jd: "京", douyin: "抖" };

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
