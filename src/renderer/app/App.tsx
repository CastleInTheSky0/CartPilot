import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  ChevronRight,
  LayoutDashboard,
  LockKeyhole,
  Monitor,
  Settings2,
  ShoppingBag,
} from "lucide-react";
import type { RuntimeInfo } from "../../shared/contracts/desktop.ts";
import { BrowserConnectionPanel } from "../features/connections/BrowserConnectionPanel.tsx";
import { ChannelStatusTable } from "../features/connections/ChannelStatusTable.tsx";
import { ConnectionChecklist } from "../features/connections/ConnectionChecklist.tsx";
import { ConnectionGuide } from "../features/connections/ConnectionGuide.tsx";
import { CONNECTION_LABELS } from "../features/connections/browser-presentation.ts";
import { useBrowserConnection } from "../features/connections/useBrowserConnection.ts";
import { RuntimeSettings } from "../features/settings/RuntimeSettings.tsx";
import styles from "./app-shell.module.css";

type View = "workspace" | "help" | "settings";
const VIEW_COPY = {
  workspace: {
    label: "购买工作台",
    eyebrow: "PURCHASE WORKSPACE",
    description: "接入日常浏览器，检查各平台的页面与登录状态。",
  },
  help: {
    label: "使用说明",
    eyebrow: "GETTING STARTED",
    description: "从浏览器授权开始，准备好你的购买环境。",
  },
  settings: {
    label: "应用设置",
    eyebrow: "LOCAL SETTINGS",
    description: "查看当前版本、运行环境与本机数据位置。",
  },
};

export function App() {
  const [view, setView] = useState<View>("workspace");
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [error, setError] = useState("");
  const connection = useBrowserConnection();
  const phase = connection.state?.connection.phase ?? "disconnected";
  const count = connection.state?.channels.filter((channel) => channel.tab).length ?? 0;
  const copy = VIEW_COPY[view];

  useEffect(() => {
    let active = true;
    void window.cartPilot.getRuntimeInfo().then(
      (result) => {
        if (active) setRuntime(result);
      },
      () => {
        if (active) setError("无法读取桌面状态，请重新启动应用。");
      },
    );
    return () => {
      active = false;
    };
  }, []);

  function navigate(next: View) {
    setView(next);
    window.scrollTo({ top: 0 });
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <button
          className={styles.brand}
          onClick={() => navigate("workspace")}
          aria-label="CartPilot 首页"
        >
          <span className={styles.brandMark}>
            <ShoppingBag size={23} />
          </span>
          <span className={styles.brandWord}>
            CartPilot<small>购买助手</small>
          </span>
        </button>
        <div className={styles.workspaceLabel}>
          个人工作空间<span>LOCAL</span>
        </div>
        <nav className={styles.nav} aria-label="主导航">
          <button
            aria-current={view === "workspace" ? "page" : undefined}
            onClick={() => navigate("workspace")}
            aria-label="购买工作台"
          >
            <LayoutDashboard size={17} />
            <span className={styles.navText}>购买工作台</span>
            <span className={styles.navCount}>{count.toString().padStart(2, "0")}</span>
          </button>
          <button
            aria-current={view === "help" ? "page" : undefined}
            onClick={() => navigate("help")}
            aria-label="使用说明"
          >
            <BookOpen size={17} />
            <span className={styles.navText}>使用说明</span>
            <ArrowUpRight size={13} className={styles.navEnd} />
          </button>
        </nav>
        <div className={styles.sidebarPlan}>
          <p>当前工作区</p>
          <strong>
            <i />
            浏览器准备
          </strong>
          <small>
            {count ? `已接入 ${count} 个商城平台` : "等待接入第一个商城页面"}
            <br />
            购买任务功能正在迁移
          </small>
        </div>
        <div className={styles.sidebarBottom}>
          <button className={styles.browserStatus} onClick={() => navigate("workspace")}>
            <Monitor size={20} />
            <span>
              <strong>
                Chrome ·{" "}
                {phase === "connected"
                  ? "已连接"
                  : phase === "connecting"
                    ? "等待授权"
                    : phase === "error"
                      ? "连接异常"
                      : "未连接"}
              </strong>
              <small>查看浏览器接入状态</small>
            </span>
            <ArrowUpRight size={12} />
          </button>
          <button
            className={styles.settingsLink}
            aria-current={view === "settings" ? "page" : undefined}
            onClick={() => navigate("settings")}
            aria-label="应用设置"
          >
            <Settings2 size={16} />
            <span className={styles.navText}>应用设置</span>
          </button>
          <div className={styles.localNote}>
            <LockKeyhole size={11} />
            仅在本机运行<span>{runtime ? `v${runtime.version}` : "桌面版"}</span>
          </div>
        </div>
      </aside>
      <div className={styles.mainShell}>
        <header className={styles.topbar}>
          <div className={styles.breadcrumbs}>
            <span>工作空间</span>
            <ChevronRight size={11} />
            <strong>{copy.label}</strong>
          </div>
          <div className={styles.topbarRight}>
            <span className={styles.connectionState} data-phase={phase}>
              <i />
              {CONNECTION_LABELS[phase]}
            </span>
            <span className={styles.avatar} aria-label="本地个人工作空间">
              S
            </span>
          </div>
        </header>
        <main className={styles.content}>
          <div className={styles.pageHeading}>
            <div>
              <div className={styles.eyebrow}>
                {copy.eyebrow}
                <span>/ LOCAL</span>
              </div>
              <h1>{copy.label}</h1>
              <p>{copy.description}</p>
            </div>
            {view === "workspace" && (
              <button className="button subtle" onClick={() => navigate("help")}>
                <BookOpen size={14} />
                接入指南
                <ArrowUpRight size={13} />
              </button>
            )}
          </div>
          <div className={styles.page} key={view}>
            {view === "workspace" && (
              <>
                <div className={styles.grid}>
                  <BrowserConnectionPanel connection={connection} />
                  <ConnectionChecklist state={connection.state} onHelp={() => navigate("help")} />
                </div>
                <ChannelStatusTable connection={connection} />
              </>
            )}
            {view === "help" && <ConnectionGuide onStart={() => navigate("workspace")} />}
            {view === "settings" && <RuntimeSettings runtime={runtime} error={error} />}
          </div>
          <footer className={styles.footer}>
            <strong>CartPilot</strong>
            <span>当前版本支持浏览器接入与状态检测，购买任务将在后续开放。</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
