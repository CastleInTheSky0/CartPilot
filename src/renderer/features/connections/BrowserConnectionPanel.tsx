import { ArrowRight, ArrowUpRight, Globe2, LoaderCircle, PlugZap, RefreshCw } from "lucide-react";
import { PlatformSchema } from "../../../shared/contracts/browser.ts";
import { CONNECTION_LABELS, PLATFORM_LABELS } from "./browser-presentation.ts";
import type { BrowserConnection } from "./useBrowserConnection.ts";
import styles from "./connections.module.css";

export function BrowserConnectionPanel({ connection }: { connection: BrowserConnection }) {
  const { profile, setProfile } = connection;
  const phase = connection.state?.connection.phase ?? "disconnected";
  const isConnected = phase === "connected";
  const isConnecting = phase === "connecting";

  return (
    <section className={styles.panel} aria-labelledby="connection-heading">
      <div className={styles.heading}>
        <h2 id="connection-heading">
          <span className="section-number">01</span>浏览器接入
        </h2>
        <span role="status" className={styles.status} data-phase={phase}>
          <i />
          {CONNECTION_LABELS[phase]}
        </span>
      </div>
      <div className={styles.browserIntro}>
        <span className={styles.browserIcon}>
          <Globe2 size={24} />
        </span>
        <div>
          <h3>连接你的日常 Chrome</h3>
          <p>沿用浏览器的登录状态，只接入你选择的商城页面。</p>
        </div>
        <span className={styles.extensionTag}>官方扩展</span>
      </div>
      <div className={styles.actions}>
        {isConnected || isConnecting ? (
          <button className="button" onClick={() => void connection.disconnect()}>
            {isConnecting && <LoaderCircle size={14} className="spin" />}
            {isConnecting ? "取消连接" : "断开连接"}
          </button>
        ) : (
          <button
            className="button primary"
            onClick={() => void connection.connect(profile)}
            disabled={connection.busy}
          >
            连接普通 Chrome
            <ArrowRight size={14} />
          </button>
        )}
        <button
          className="button subtle"
          onClick={() => void connection.install()}
          disabled={connection.busy}
        >
          安装官方扩展
          <ArrowUpRight size={14} />
        </button>
      </div>
      <p className={styles.message} data-error={phase === "error"}>
        {connection.state?.connection.message ?? "正在读取浏览器连接状态…"}
      </p>
      {connection.error && (
        <p className={styles.error} role="alert">
          {connection.error}
        </p>
      )}
      <div className={styles.binding}>
        <div className={styles.bindingHeading}>
          <PlugZap size={15} />
          <h3>接入商城标签页</h3>
          <button
            className="button subtle"
            onClick={() => void connection.list()}
            disabled={!isConnected || connection.busy}
          >
            <RefreshCw size={13} />
            刷新列表
          </button>
        </div>
        <div className={styles.picker}>
          <label className={styles.platformSelect}>
            选择平台
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
          <label className={styles.tabSelect}>
            选择已打开的页面
            <select
              value={connection.tabId}
              onChange={(event) => connection.setTabId(event.target.value)}
              disabled={!isConnected || connection.busy || !connection.tabs.length}
            >
              {!connection.tabs.length && (
                <option value="">
                  {isConnected ? "请打开商城页面，再刷新列表" : "连接 Chrome 后选择标签页"}
                </option>
              )}
              {connection.tabs.map((tab) => (
                <option key={tab.id} value={tab.id}>
                  {tab.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className={styles.bindAction}>
          <span>每个平台分别接入，登录状态自动检测。</span>
          <button
            className="button"
            onClick={() => void connection.bind()}
            disabled={!isConnected || !connection.tabId || connection.busy}
          >
            接入所选标签页
            <ArrowRight size={13} />
          </button>
        </div>
      </div>
      <details className={styles.profile}>
        <summary>Chrome 资料目录（可选）</summary>
        <label>
          可选资料目录名
          <input
            value={profile}
            onChange={(event) => setProfile(event.target.value)}
            placeholder="自动检测，或填 Default / Profile 1"
            disabled={isConnected || isConnecting}
          />
        </label>
        <p>多个 Chrome 用户时可指定目录，连接时自动保存。</p>
      </details>
    </section>
  );
}
