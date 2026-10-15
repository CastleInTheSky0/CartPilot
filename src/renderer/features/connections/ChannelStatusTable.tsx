import { ArrowUpRight, Apple, RefreshCw } from "lucide-react";
import { PlatformSchema } from "../../../shared/contracts/browser.ts";
import { PLATFORM_LABELS, PLATFORM_MARKS, loginPresentation } from "./browser-presentation.ts";
import type { BrowserConnection } from "./useBrowserConnection.ts";
import styles from "./channel-table.module.css";

export function ChannelStatusTable({ connection }: { connection: BrowserConnection }) {
  const count = connection.state?.channels.filter((channel) => channel.tab).length ?? 0;

  return (
    <section className={styles.section} aria-labelledby="channels-heading">
      <div className={styles.heading}>
        <div>
          <h2 id="channels-heading">商城连接状态</h2>
          <p>各平台的标签页接入与登录状态单独检查。</p>
        </div>
        <span>{count} / 5 个平台已接入</span>
      </div>
      <div className={styles.tableWrap}>
        <table>
          <thead>
            <tr>
              <th scope="col">购买渠道</th>
              <th scope="col">接入页面</th>
              <th scope="col">商城登录</th>
              <th scope="col" className={styles.actionsHeading}>
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            {PlatformSchema.options.map((platform) => {
              const channel = connection.state?.channels.find((item) => item.platform === platform);
              const login = loginPresentation(channel);
              return (
                <tr key={platform}>
                  <th scope="row">
                    <div className={styles.platform}>
                      <span className={styles.mark}>
                        {platform === "apple" ? <Apple size={16} /> : PLATFORM_MARKS[platform]}
                      </span>
                      {PLATFORM_LABELS[platform]}
                    </div>
                  </th>
                  <td>
                    <span className={styles.pageTitle} title={channel?.tab?.title}>
                      {channel?.tab?.title ??
                        (channel?.login.reason === "page_changed"
                          ? "页面已变化或关闭"
                          : "尚未接入标签页")}
                    </span>
                    {channel?.tab && <small title={channel.tab.url}>{channel.tab.url}</small>}
                  </td>
                  <td>
                    <span
                      className={styles.login}
                      data-tone={login.tone}
                      title={channel?.login.message}
                    >
                      <i />
                      {login.label}
                    </span>
                    {channel?.login.checkedAt && (
                      <small>
                        {new Date(channel.login.checkedAt).toLocaleTimeString("zh-CN", {
                          hour12: false,
                        })}{" "}
                        检测
                      </small>
                    )}
                  </td>
                  <td>
                    <div className={styles.actions}>
                      <button
                        onClick={() => void connection.refresh(platform)}
                        disabled={!channel?.tab || connection.busy}
                        aria-label={`重新检测${PLATFORM_LABELS[platform]}登录状态`}
                      >
                        <RefreshCw size={12} />
                        重新检测
                      </button>
                      <button
                        onClick={() => void connection.focus(platform)}
                        disabled={!channel?.tab || connection.busy}
                        aria-label={`定位${PLATFORM_LABELS[platform]}页面`}
                      >
                        定位页面
                        <ArrowUpRight size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className={styles.note}>
        <span />
        登录状态每 10 秒自动检测；扩展已连接不代表商城已登录。
      </p>
    </section>
  );
}
