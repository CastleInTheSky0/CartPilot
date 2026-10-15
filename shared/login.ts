import { LOGIN_STATUS_TTL, type ChannelState, type LoginStatus } from "./types.ts";

export function loginDisplay(channel: ChannelState | undefined, connected: boolean, now = Date.now()) {
  const saved = channel?.login;
  let state: LoginStatus["state"] = saved?.state ?? "unknown";
  let reason = saved?.reason ?? "browser_closed";
  let message = saved?.message ?? "请先打开此平台的执行窗口，再检测登录状态。";
  if (!connected) {
    state = "unknown"; reason = "unavailable";
    message = "本地服务未连接，无法确认当前登录状态。";
  } else if (!channel?.browserOpen) {
    state = "unknown"; reason = "browser_closed";
    message = "执行窗口未打开；已保存的会话会在打开后检测。";
  } else if (state !== "unknown" && (!saved?.checkedAt || !Number.isFinite(Date.parse(saved.checkedAt)) || now - Date.parse(saved.checkedAt) > LOGIN_STATUS_TTL)) {
    state = "unknown"; reason = "stale";
    message = "上次检测已过期，请重新检测或查看执行窗口。";
  }
  return {
    state, reason, message, checkedAt: saved?.checkedAt ?? null,
    label: state === "logged_in" ? "已登录" : state === "logged_out" ? "需要登录" : reason === "browser_closed" ? "未检测" : "暂无法确认",
  };
}
