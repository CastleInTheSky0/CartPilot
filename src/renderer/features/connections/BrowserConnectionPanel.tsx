import { PlatformSchema } from "../../../shared/contracts/browser.ts";
import { useBrowserConnection } from "./useBrowserConnection.ts";
import styles from "./connections.module.css";

const PLATFORM_LABELS = {
  apple: "Apple 中国官网",
  taobao: "淘宝",
  tmall: "天猫",
  jd: "京东",
  douyin: "抖音商城",
};
const CONNECTION_LABELS = {
  disconnected: "未连接",
  connecting: "等待授权",
  connected: "已连接",
  error: "连接异常",
};

export function BrowserConnectionPanel() {
  const connection = useBrowserConnection();
  const { profile, setProfile } = connection;
  const phase = connection.state?.connection.phase ?? "disconnected";
  const isConnected = phase === "connected";
  const isConnecting = phase === "connecting";

  return (
    <section className="connection-section" aria-labelledby="connection-heading">
      <div className={styles.heading}>
        <h2 id="connection-heading">浏览器接入</h2>
        <span role="status" className={styles.status} data-connected={isConnected}>
          {CONNECTION_LABELS[phase]}
        </span>
      </div>
      <p>{connection.state?.connection.message ?? "正在读取浏览器连接状态…"}</p>
      <div className={styles.actions}>
        <button onClick={() => void connection.install()} disabled={connection.busy}>
          安装官方扩展
        </button>
        {isConnected || isConnecting ? (
          <button onClick={() => void connection.disconnect()}>
            {isConnecting ? "取消连接" : "断开连接"}
          </button>
        ) : (
          <button
            className={styles.primary}
            onClick={() => void connection.connect(profile)}
            disabled={connection.busy}
          >
            连接普通 Chrome
          </button>
        )}
        <details>
          <summary>Chrome 资料目录</summary>
          <label className={styles.profile}>
            可选资料目录名
            <input
              value={profile}
              onChange={(event) => setProfile(event.target.value)}
              placeholder="自动检测，或填 Default / Profile 1"
              disabled={isConnected || isConnecting}
            />
          </label>
        </details>
      </div>
      {connection.error && <p role="alert">{connection.error}</p>}
      <div className={styles.binding}>
        <label>
          平台
          <select
            value={connection.platform}
            onChange={(event) => connection.setPlatform(PlatformSchema.parse(event.target.value))}
            disabled={connection.busy}
          >
            {PlatformSchema.options.map((platform) => (
              <option key={platform} value={platform}>
                {PLATFORM_LABELS[platform]}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => void connection.list()} disabled={!isConnected || connection.busy}>
          刷新标签列表
        </button>
        <label className={styles.tabSelect}>
          选择已打开的页面
          <select
            value={connection.tabId}
            onChange={(event) => connection.setTabId(event.target.value)}
            disabled={!isConnected || connection.busy || !connection.tabs.length}
          >
            {!connection.tabs.length && (
              <option value="">先在 Chrome 打开商城页面，再刷新列表</option>
            )}
            {connection.tabs.map((tab) => (
              <option key={tab.id} value={tab.id}>
                {tab.title}
              </option>
            ))}
          </select>
        </label>
        <button
          className={styles.primary}
          onClick={() => void connection.bind()}
          disabled={!isConnected || !connection.tabId || connection.busy}
        >
          接入所选标签页
        </button>
      </div>
      <div className={styles.tableWrap}>
        <table>
          <thead>
            <tr>
              <th>平台</th>
              <th>接入页面</th>
              <th>商城登录</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {PlatformSchema.options.map((platform) => {
              const channel = connection.state?.channels.find((item) => item.platform === platform);
              const login = channel?.login;
              const label =
                login?.state === "logged_in"
                  ? "已登录"
                  : login?.state === "logged_out"
                    ? "需要登录"
                    : channel?.tab
                      ? "暂无法确认"
                      : "未检测";
              return (
                <tr key={platform}>
                  <td>{PLATFORM_LABELS[platform]}</td>
                  <td title={channel?.tab?.url}>
                    {channel?.tab?.title ??
                      (login?.reason === "page_changed" ? "页面已变化或关闭" : "未接入")}
                  </td>
                  <td title={login?.message}>
                    {label}
                    {login?.checkedAt && (
                      <small>
                        {new Date(login.checkedAt).toLocaleTimeString("zh-CN", { hour12: false })}{" "}
                        检测
                      </small>
                    )}
                  </td>
                  <td>
                    <div className={styles.rowActions}>
                      <button
                        onClick={() => void connection.refresh(platform)}
                        disabled={!channel?.tab || connection.busy}
                      >
                        重新检测
                      </button>
                      <button
                        onClick={() => void connection.focus(platform)}
                        disabled={!channel?.tab || connection.busy}
                      >
                        定位页面
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
