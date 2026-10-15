import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  CalendarClock,
  Check,
  CheckCheck,
  ChevronDown,
  CircleHelp,
  Clock3,
  ExternalLink,
  FileClock,
  Globe2,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  Monitor,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  Square,
  Terminal,
  X,
  Zap,
} from "lucide-react";
import {
  ACTIVE_PHASES,
  CAPACITIES,
  COLORS,
  DEFAULT_SETTINGS,
  PHASE_LABELS,
  PLATFORMS,
  PLATFORM_INFO,
  REFERENCE_PRICES,
  EXTENSION_INSTALL_URL,
  type AppState,
  type Settings,
  type Selectors,
  type Phase,
  type Platform,
  type RunMode,
  type BrowserTab,
  type BrowserMode,
} from "../shared/types";
import { loginDisplay } from "../shared/login";

type Tab = "workspace" | "logs" | "help";
const yuan = (number: number) =>
  number.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const time = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
function beijingInput(value: string) {
  const date = new Date(new Date(value).getTime() + 8 * 3600_000);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 16) : "";
}

async function api(endpoint: string, data: unknown = {}) {
  const response = await fetch(`/api/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Duo-Client": "1" },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "操作失败，请重试。");
  return result;
}

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [config, setConfig] = useState<Settings>(
    structuredClone(DEFAULT_SETTINGS),
  );
  const [connected, setConnected] = useState(false);
  const [mode, setMode] = useState<RunMode>("single");
  const [enabledPlatforms, setEnabledPlatforms] = useState<Platform[]>(["apple"]);
  const [tab, setTab] = useState<Tab>("workspace");
  const [pending, setPending] = useState("");
  const [profileDirectory, setProfileDirectory] = useState("");
  const [browserTabs, setBrowserTabs] = useState<BrowserTab[]>([]);
  const [selectedBrowserTab, setSelectedBrowserTab] = useState("");
  const [tabsError, setTabsError] = useState("");
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const [now, setNow] = useState(Date.now());
  const [advanced, setAdvanced] = useState(false);
  const [confirm, setConfirm] = useState<
    "scheduled" | "immediate" | "resolve" | null
  >(null);
  const [accepted, setAccepted] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState(
    typeof Notification === "undefined"
      ? "unsupported"
      : Notification.permission,
  );
  const [logFilter, setLogFilter] = useState("all");
  const initialized = useRef(false);
  const clockOffset = useRef(0);
  const previousPhase = useRef("");
  const previousChannels = useRef<Record<string, string>>({});
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function notify(text: string, error = false) {
    setToast({ text, error });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 6500);
  }

  useEffect(() => {
    const receive = (next: AppState) => {
      setState(next);
      clockOffset.current = Date.parse(next.serverNow) - Date.now();
      setNow(Date.now() + clockOffset.current);
      setConnected(true);
      if (!initialized.current) {
        setConfig(next.settings);
        setMode(next.workspace.mode);
        setEnabledPlatforms(next.workspace.enabledPlatforms);
        setProfileDirectory(next.browserConnection?.profileDirectory ?? "");
        initialized.current = true;
      }
      const key = `${next.runId}:${next.phase}`;
      if (
        previousPhase.current &&
        key !== previousPhase.current &&
        next.runId &&
        ["cooldown", "awaiting_user", "ready", "completed", "error"].includes(next.phase) &&
        (next.winner ? next.workspace.plans[next.winner].notifications : next.settings.notifications)
      ) {
        if ("Notification" in window && Notification.permission === "granted")
          new Notification(`Duo · ${PHASE_LABELS[next.phase]}`, {
            body: next.message,
            icon: "/favicon.svg",
            tag: "duo-task",
          });
      }
      previousPhase.current = key;
      for (const platform of next.runPlatforms) {
        const channel = next.channels[platform];
        const channelKey = `${next.runId}:${channel.phase}`;
        if (next.runPlatforms.length > 1 && !next.winner && previousChannels.current[platform] && previousChannels.current[platform] !== channelKey && ["cooldown", "awaiting_user"].includes(channel.phase) && next.workspace.plans[platform].notifications && "Notification" in window && Notification.permission === "granted")
          new Notification(`Duo · ${PLATFORM_INFO[platform].shortName}需要接手`, { body: channel.message, icon: "/favicon.svg", tag: `duo-${platform}` });
        previousChannels.current[platform] = channelKey;
      }
    };
    const events = new EventSource("/api/events");
    events.onmessage = (event) => {
      try {
        receive(JSON.parse(event.data));
      } catch {
        setConnected(false);
      }
    };
    events.onerror = () => setConnected(false);
    fetch("/api/state")
      .then((response) => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then(receive)
      .catch(() => setConnected(false));
    const timer = setInterval(
      () => setNow(Date.now() + clockOffset.current),
      250,
    );
    return () => {
      events.close();
      clearInterval(timer);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const browserMode = state?.browserConnection?.mode ?? "extension";
  const extensionMode = browserMode === "extension";
  const extension = state?.browserConnection?.extension;
  useEffect(() => {
    let cancelled = false;
    setBrowserTabs([]); setSelectedBrowserTab(""); setTabsError("");
    if (extensionMode && connected && extension?.phase === "connected") {
      fetch(`/api/browser/extension/tabs?platform=${config.platform}`).then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        if (!cancelled) { setBrowserTabs(result.tabs); setSelectedBrowserTab(result.tabs[0]?.id ?? ""); }
      }).catch((error) => { if (!cancelled) setTabsError(error instanceof Error ? error.message : "标签页列表读取失败。"); });
    }
    return () => { cancelled = true; };
  }, [extensionMode, extension?.phase, connected, config.platform]);

  useEffect(() => {
    if (!confirm && !advanced) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setConfirm(null);
        setAdvanced(false);
      }
      if (event.key === "Tab") {
        const controls = Array.from(
          document.querySelectorAll<HTMLElement>(
            ".modal button:not(:disabled), .modal input:not(:disabled), .modal select:not(:disabled), .modal a[href]",
          ),
        );
        const first = controls[0],
          last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", close);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", close);
      document.body.style.overflow = previous;
      previousFocus?.focus();
    };
  }, [confirm, advanced]);

  const active = state ? ACTIVE_PHASES.includes(state.phase) : false;
  const disabled = !!pending || !connected || !state || state.browserBusy;
  const editingDisabled = disabled || active;
  const dirty = state
    ? JSON.stringify(config) !== JSON.stringify(state.settings) || mode !== state.workspace.mode || JSON.stringify(enabledPlatforms) !== JSON.stringify(state.workspace.enabledPlatforms)
    : false;
  const remaining = Math.max(0, Date.parse(config.launchAt) - now);
  const totalSeconds = Math.floor(remaining / 1000);
  const countdown = [
    Math.floor(totalSeconds / 86400),
    Math.floor(totalSeconds / 3600) % 24,
    Math.floor(totalSeconds / 60) % 60,
    totalSeconds % 60,
  ];
  const awaiting = state?.phase === "awaiting_user" || state?.phase === "ready";
  const locked = !!state?.submission && !state.submission.resolved;
  const platform = PLATFORM_INFO[config.platform];
  const currentChannel = state?.channels[config.platform];
  const currentLogin = loginDisplay(currentChannel, connected, now);
  if (connected && extensionMode && !currentChannel?.browserOpen) currentLogin.message = "此平台尚未接入标签页，请在上方连接浏览器并选择商城标签页。";
  const cooling = !!currentChannel?.cooldownUntil && Date.parse(currentChannel.cooldownUntil) > now;
  const resumeChannel = state?.channels[state.winner ?? config.platform];
  const resumeCooling = !!resumeChannel?.cooldownUntil && Date.parse(resumeChannel.cooldownUntil) > now;
  const planned = (mode === "race" ? enabledPlatforms : [config.platform]).map((id) => id === config.platform ? config : state?.workspace.plans[id]).filter((plan): plan is Settings => !!plan);
  const missing = planned.filter((plan) => !plan.productUrl);
  const anyAuto = planned.some((plan) => plan.autoSubmit);
  const sameMarketplaceItem = state?.workspace.plans.taobao.productUrl && state.workspace.plans.taobao.productUrl === state.workspace.plans.tmall.productUrl;

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setConfig((current) => ({ ...current, [key]: value }));
  }
  async function action(
    label: string,
    work: () => Promise<unknown>,
    success?: string,
  ) {
    setPending(label);
    try {
      await work();
      if (success) notify(success);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "操作失败，请重试。",
        true,
      );
    } finally {
      setPending("");
    }
  }
  const save = () => api("settings", { ...config, mode, enabledPlatforms });
  async function showBrowser(login = true) {
    if (extensionMode && !currentChannel?.browserOpen) {
      setTab("workspace");
      requestAnimationFrame(() => document.getElementById("browser-connection")?.scrollIntoView({ behavior: "smooth", block: "center" }));
      return;
    }
    await api("browser/open", { login, platform: config.platform });
  }
  async function configureBrowser(next: BrowserMode) {
    await api("browser/connection", { version: 1, mode: next, profileDirectory: profileDirectory.trim() || null });
  }
  async function reloadBrowserTabs() {
    const response = await fetch(`/api/browser/extension/tabs?platform=${config.platform}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "无法读取标签页列表。");
    setBrowserTabs(result.tabs); setSelectedBrowserTab(result.tabs[0]?.id ?? ""); setTabsError("");
  }
  async function switchPlatform(next: Platform) {
    if (next === config.platform) return;
    await action("platform", async () => {
      await save();
      const result = await api("platform", { platform: next });
      setConfig(result.settings);
    });
  }
  function requestStart(mode: "scheduled" | "immediate") {
    setAccepted(false);
    setConfirm(mode);
  }
  async function start() {
    if (!accepted || !confirm) return;
    const mode = confirm;
    setConfirm(null);
    await action(
      "start",
      async () => {
        if (mode === "resolve") {
          await api("task/resolve-submission", { reviewed: true });
          return;
        }
        await save();
        await api("task/start", { immediate: mode === "immediate" });
      },
      mode === "resolve" ? "已复核提交记录。" : "任务已启动。",
    );
  }
  async function enableNotifications() {
    if (!("Notification" in window)) {
      notify("当前浏览器不支持系统通知，可在此页面查看任务状态。");
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    notify(
      permission === "granted"
        ? "系统通知已开启。需要接手时会提醒你。"
        : "可在浏览器的站点设置中开启通知权限。",
    );
  }

  const logs = (state?.logs ?? []).filter(
    (log) =>
      logFilter === "all" ||
      (logFilter === "warn"
        ? ["warn", "error"].includes(log.level)
        : log.level === logFilter),
  );
  const phase: Phase = state?.phase ?? "idle";
  const stepIndex = [
    "configuring",
    "bag",
    "checkout",
    "ready",
    "submitting",
    "completed",
  ].indexOf(phase);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            setTab("workspace");
          }}
          aria-label="Duo 首发助手首页"
        >
          <span className="brand-mark">
            d<span>.</span>
          </span>
          <span className="brand-word">
            duo<span>首发助手</span>
          </span>
        </a>
        <div className="workspace-label">
          个人工作空间<span>LOCAL</span>
        </div>
        <nav className="nav" aria-label="主导航">
          <button
            className={tab === "workspace" ? "nav-item selected" : "nav-item"}
            onClick={() => setTab("workspace")}
          >
            <LayoutDashboard size={18} />
            任务工作台<span className="nav-count">01</span>
          </button>
          <button
            className={tab === "logs" ? "nav-item selected" : "nav-item"}
            onClick={() => setTab("logs")}
          >
            <FileClock size={18} />
            运行记录
            {state?.logs.length ? <span className="nav-log-dot" /> : null}
          </button>
          <button
            className={tab === "help" ? "nav-item selected" : "nav-item"}
            onClick={() => setTab("help")}
          >
            <BookOpen size={18} />
            使用说明
            <ArrowUpRight size={14} className="nav-end" />
          </button>
        </nav>
        <div className="sidebar-plan">
          <div className="eyebrow">当前购买计划</div>
          <span className="plan-dot" />
          <strong>iPhone Duo</strong>
          <p>{mode === "race" ? `已选择 ${enabledPlatforms.length} 个渠道` : platform.name}</p>
          <span className="plan-date">
            {beijingInput(config.launchAt).slice(5, 10).replace("-", ".")}{" "}
            <span>/</span> {beijingInput(config.launchAt).slice(11)}{" "}
            <span>CST</span>
          </span>
        </div>
        <div className="sidebar-bottom">
          <button
            className={`browser-status login-${currentLogin.state}`}
            disabled={disabled}
            onClick={() =>
              action("browser", () => showBrowser())
            }
          >
            <span className="browser-icon">
              <Monitor size={18} />
            </span>
            <span>
              <strong>
                {platform.shortName} · {currentLogin.label}
              </strong>
              <small>
                {currentChannel?.browserOpen
                  ? "点击查看执行窗口"
                  : extensionMode ? "点击连接并接入标签页" : `点击打开${platform.shortName}登录`}
              </small>
            </span>
            <ArrowUpRight size={14} />
          </button>
          <div className="local-note">
            <LockKeyhole size={12} /> 仅在本机运行 <span>v2.1</span>
          </div>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            工作空间 <span>/</span>{" "}
            <strong>
              {tab === "workspace"
                ? "任务工作台"
                : tab === "logs"
                  ? "运行记录"
                  : "使用说明"}
            </strong>
          </div>
          <div className="topbar-right">
            <span className={`service-state ${connected ? "" : "offline"}`}>
              <i />
              {connected ? "本地服务在线" : "连接本地服务中"}
            </span>
            <span className="topbar-divider" />
            <button
              className={`icon-button ${notificationPermission === "granted" ? "notification-on" : ""}`}
              onClick={enableNotifications}
              aria-label="开启系统通知"
              title={
                notificationPermission === "granted"
                  ? "系统通知已开启"
                  : "开启系统通知"
              }
            >
              <Bell size={18} />
            </button>
            <span className="avatar">S</span>
          </div>
        </header>
        <main className="main-content">
          {!connected && (
            <div className="connection-banner">
              <LoaderCircle size={16} className="spin" />
              正在连接本地服务。请保持启动窗口开启。
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow page-eyebrow">
                LAUNCH ASSISTANT <span>/ 001</span>
              </div>
              <h1>
                {tab === "workspace"
                  ? "首发计划"
                  : tab === "logs"
                    ? "运行记录"
                    : "开始之前"}
              </h1>
              <p>
                {tab === "workspace"
                  ? "配置购买目标、开售时间和自动化范围。"
                  : tab === "logs"
                    ? "查看本机任务的真实执行记录。"
                    : "用几分钟，准备好你的首发任务。"}
              </p>
            </div>
            <div className="heading-actions">
              {tab === "workspace" ? (
                <>
                  <button
                    className="button subtle"
                    disabled={editingDisabled}
                    onClick={() => setAdvanced(true)}
                  >
                    <Settings2 size={15} />
                    高级适配
                  </button>
                  <button
                    className="button secondary"
                    disabled={editingDisabled || !dirty}
                    onClick={() => action("save", save, "购买配置已保存。")}
                  >
                    {pending === "save" ? (
                      <LoaderCircle size={15} className="spin" />
                    ) : (
                      <Save size={15} />
                    )}
                    保存配置{dirty && <i className="unsaved-dot" />}
                  </button>
                </>
              ) : tab === "logs" ? (
                <a
                  className="button secondary"
                  href="/api/logs/export"
                  download
                >
                  <ArrowDownToLine size={15} />
                  导出记录
                </a>
              ) : (
                <button
                  className="button secondary"
                  onClick={() => setTab("workspace")}
                >
                  进入工作台
                  <ArrowRight size={15} />
                </button>
              )}
            </div>
          </div>

          {tab === "workspace" ? (
            <>
              <section className="platform-workspace" aria-label="购买渠道配置">
                <div className="platform-heading">
                  <h2>购买渠道</h2>
                  <div className="mode-tabs" role="group" aria-label="渠道执行方式">
                    <button disabled={editingDisabled} className={mode === "single" ? "selected" : ""} aria-pressed={mode === "single"} onClick={() => setMode("single")}>单个平台</button>
                    <button disabled={editingDisabled} className={mode === "race" ? "selected" : ""} aria-pressed={mode === "race"} onClick={() => setMode("race")}>多平台同时监控</button>
                  </div>
                </div>
                <div className="platform-options">
                  {PLATFORMS.map((id) => {
                    const ready = id === config.platform ? !!config.productUrl : !!state?.workspace.plans[id].productUrl;
                    const login = loginDisplay(state?.channels[id], connected, now);
                    return <div key={id} className={`platform-option ${config.platform === id ? "selected" : ""}`}>
                      {mode === "race" && <input type="checkbox" aria-label={`同时监控${PLATFORM_INFO[id].name}`} checked={enabledPlatforms.includes(id)} disabled={editingDisabled || (enabledPlatforms.length === 1 && enabledPlatforms.includes(id))} onChange={(event) => setEnabledPlatforms((current) => event.target.checked ? [...current, id] : current.filter((value) => value !== id))} />}
                      <button disabled={editingDisabled} aria-pressed={config.platform === id} onClick={() => switchPlatform(id)}>
                        <strong>{PLATFORM_INFO[id].shortName}</strong>
                        <span className={`login-badge login-${login.state}`} aria-label={`${PLATFORM_INFO[id].shortName}登录状态：${login.label}`}><i />{login.label}</span>
                        <small>{ready ? "已配置商品" : "待填商品链接"}</small>
                      </button>
                    </div>;
                  })}
                </div>
                <div id="browser-connection" className="browser-connection-panel" aria-label="浏览器接入设置">
                  <div className="connection-choice">
                    <strong>浏览器接入</strong>
                    <div className="mode-tabs" role="group" aria-label="浏览器连接方式">
                      <button disabled={editingDisabled} aria-pressed={extensionMode} className={extensionMode ? "selected" : ""} onClick={() => action("browser-mode", () => configureBrowser("extension"))}>普通浏览器扩展</button>
                      <button disabled={editingDisabled} aria-pressed={!extensionMode} className={!extensionMode ? "selected" : ""} onClick={() => action("browser-mode", () => configureBrowser("managed"))}>助手独立窗口</button>
                    </div>
                    {extensionMode && <span className={`extension-state ${connected && extension?.phase === "connected" ? "is-connected" : ""}`} role="status"><i />{!connected ? "连接本地服务中" : extension?.phase === "connected" ? "扩展已连接" : extension?.phase === "connecting" ? "等待浏览器授权" : extension?.phase === "error" ? "连接未成功" : "扩展未连接"}</span>}
                  </div>
                  {extensionMode ? <>
                    <p className="connection-description">沿用你日常 Chrome 的登录会话。安装官方扩展，允许连接，再选择要接入的商城标签页。</p>
                    <div className="extension-actions">
                      <button className="button secondary" disabled={editingDisabled} onClick={() => action("install-extension", () => api("browser/extension/install"))}>安装官方扩展<ArrowUpRight size={13} /></button>
                      {extension?.phase === "connected" || extension?.phase === "connecting" ?
                        <button className="button secondary" disabled={disabled} onClick={() => action("disconnect-extension", () => api("browser/extension/disconnect"))}>{extension.phase === "connecting" ? <><LoaderCircle size={14} className="spin" />取消连接</> : "断开扩展连接"}</button> :
                        <button className="button primary" disabled={editingDisabled} onClick={() => action("connect-extension", async () => { await configureBrowser("extension"); await api("browser/extension/connect"); })}>连接普通 Chrome<ArrowRight size={14} /></button>}
                      <a href={EXTENSION_INSTALL_URL} target="_blank" rel="noreferrer" className="text-button">手动打开安装页<ExternalLink size={12} /></a>
                    </div>
                    <p className={`extension-message ${extension?.phase === "error" ? "is-error" : ""}`}>{extension?.message ?? "尚未连接普通浏览器。"}</p>
                    {extension?.phase === "connected" && <div className="extension-tab-picker">
                      <label htmlFor="extension-tab">选择{platform.shortName}标签页
                        <select id="extension-tab" value={selectedBrowserTab} disabled={editingDisabled} onChange={(event) => setSelectedBrowserTab(event.target.value)}>
                          <option value="">{browserTabs.length ? "请选择要接入的标签页" : "未找到此平台标签页，请先在普通 Chrome 打开"}</option>
                          {browserTabs.map((browserTab) => <option value={browserTab.id} key={browserTab.id}>{browserTab.title} · {browserTab.url}</option>)}
                        </select>
                      </label>
                      <button className="button secondary" disabled={editingDisabled} onClick={() => action("extension-tabs", reloadBrowserTabs)}><RefreshCw size={14} />刷新列表</button>
                      <button className="button primary" disabled={editingDisabled || !selectedBrowserTab} onClick={() => action("bind-tab", () => api("browser/extension/bind", { platform: config.platform, tabId: selectedBrowserTab }), "标签页已接入，登录状态将自动检测。")}>接入所选标签页</button>
                    </div>}
                    {tabsError && <p className="extension-message is-error">{tabsError}</p>}
                    {extension?.phase === "connected" && currentChannel?.extensionTab && <p className="bound-tab"><CheckCheck size={13} />{platform.shortName}已接入：{currentChannel.extensionTab.title}</p>}
                    <details className="extension-profile"><summary>Chrome 资料目录（可选）</summary><p>默认自动选择已安装扩展的资料。若有多个 Chrome 用户，可填 Default 或 Profile 1 等目录名。</p><div><input aria-label="Chrome 资料目录" placeholder="自动选择" value={profileDirectory} disabled={editingDisabled} onChange={(event) => setProfileDirectory(event.target.value)} /><button className="button secondary" disabled={editingDisabled} onClick={() => action("save-profile", () => configureBrowser("extension"), "资料目录已保存，请重新连接扩展。")}>保存目录</button></div></details>
                    <p className="connection-footnote">助手只操作你接入的标签页及其打开的弹窗。断开连接会停止购买任务，并保留普通浏览器网页。</p>
                  </> : <p className="connection-description">使用各平台独立的 Chrome 资料。请在助手打开的窗口登录；日常浏览器的会话不会自动复制。</p>}
                </div>
                <div className={`login-status-panel login-${currentLogin.state}`} aria-label={`${platform.shortName}登录状态`}>
                  <div className="login-status-icon" aria-hidden="true">{currentLogin.state === "logged_in" ? <ShieldCheck size={23} /> : <CircleHelp size={23} />}</div>
                  <div className="login-status-copy">
                    <div className="login-status-title"><span>{platform.shortName}登录状态</span><strong role="status" aria-live="polite">{currentLogin.label}</strong></div>
                    <p>{currentLogin.message}</p>
                    <small>{extensionMode ? "仅检测此平台已接入的标签页" : "仅检测此平台的助手执行窗口"} · 每 10 秒自动更新{currentLogin.checkedAt && <> · 最近检测 {time(currentLogin.checkedAt)}</>}</small>
                  </div>
                  <div className="login-status-actions">
                    <button className="button secondary" disabled={disabled || !currentChannel?.browserOpen} title={currentChannel?.browserOpen ? "只读检测，不刷新商城页面" : "请先打开执行窗口"} onClick={() => action("login-status", () => api("browser/login-status", { platform: config.platform }))}>
                      {pending === "login-status" ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}重新检测
                    </button>
                    <button className="button subtle" disabled={disabled} onClick={() => action("login-window", () => showBrowser())}>
                      {currentChannel?.browserOpen ? extensionMode ? "查看接入标签页" : "查看执行窗口" : extensionMode ? "接入标签页" : "打开登录"}<ArrowUpRight size={14} />
                    </button>
                  </div>
                </div>
                <div className="platform-link-row">
                  <label htmlFor="product-link">{platform.shortName}商品链接
                    <input id="product-link" type="url" value={config.productUrl} placeholder={platform.hint} disabled={editingDisabled} spellCheck={false} onChange={(event) => update("productUrl", event.target.value)} />
                  </label>
                  <button className="button secondary" disabled={editingDisabled} onClick={() => action("search", () => api("browser/open", { platform: config.platform, search: true }))}>查找商品<ArrowUpRight size={14} /></button>
                  <button className="button subtle" disabled={editingDisabled} onClick={() => action("capture", async () => { await save(); const result = await api("browser/capture"); setConfig(result.settings); }, "当前商品链接已保存。")}>读取当前商品</button>
                </div>
                <p className="platform-note">{mode === "race" ? "勾选参与渠道并分别登录，相同商品自动合并监控。首个可购买渠道进入结账，其余停止。" : platform.note}</p>
                <p className="platform-note">{state?.browserName ?? "Chrome · 普通浏览器扩展"}。{extensionMode ? "请为各渠道分别接入对应商城标签页，复用所在 Chrome 资料的登录会话。" : "首次请在实际执行窗口登录，之后复用该平台的专用资料。"}</p>
                {sameMarketplaceItem && ((mode === "race" && enabledPlatforms.includes("taobao") && enabledPlatforms.includes("tmall")) || ["taobao", "tmall"].includes(config.platform)) && <p className="platform-note">淘宝与天猫当前为同一商品，启动时合并到天猫监控，{extensionMode ? "只需接入天猫标签页" : "使用天猫执行窗口的登录会话"}。两处购买配置需一致。</p>}
                {currentChannel?.restriction && <div className="access-note" role="status">
                  <div><strong>{cooling ? `访问冷却 · 剩余 ${Math.ceil((Date.parse(currentChannel.cooldownUntil!) - now) / 1000)} 秒` : "等待检查执行页面"}</strong><p>{currentChannel.restriction}</p>
                    {currentChannel.cooldownUntil && <small>冷却结束：{time(currentChannel.cooldownUntil)}（北京时间）</small>}
                  </div>
                  <button className="button secondary" disabled={disabled} onClick={() => action("focus-restricted", () => api("browser/open", { platform: config.platform, focus: true }))}>查看浏览器</button>
                  {!active && <button className="button secondary" disabled={disabled || cooling} onClick={() => action("review-access", () => api("browser/review", { platform: config.platform }), "已解除访问暂停，下次检查会重新核对页面。")}>已验证，解除暂停</button>}
                </div>}
                {config.platform !== "apple" && <label className="backup-link">同渠道备用商品链接（可选，沿用此处规格、预算与计划，仅到刷新时间才切换）<input type="url" value={config.backupProductUrl} placeholder="填写另一个完整商品详情链接" disabled={editingDisabled} onChange={(event) => update("backupProductUrl", event.target.value)} /></label>}
                {missing.length > 0 && <p className="missing-links">{missing.map((plan) => PLATFORM_INFO[plan.platform].shortName).join("、")}尚未配置商品详情链接。</p>}
              </section>
              <div className="workspace-grid">
                <section
                  className="product-panel panel"
                  aria-labelledby="product-title"
                >
                  <div className="panel-topline">
                    <span className="section-number">01</span>
                    <span>购买目标</span>
                    <a
                      href={config.productUrl || platform.searchUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      商品详情
                      <ArrowUpRight size={14} />
                    </a>
                  </div>
                  <div className="product-visual">
                    <div className="product-caption">
                      <span className="product-kicker">APPLE</span>
                      <h2 id="product-title">
                        iPhone
                        <br />
                        Duo<span>.</span>
                      </h2>
                      <span className="product-edition">首发预购</span>
                    </div>
                    <img
                      key={config.color}
                      src={
                        config.color === "星光白色"
                          ? "/iphone-duo-white.png"
                          : "/iphone-duo-black.png"
                      }
                      alt={`${config.color} iPhone Duo 官方产品图`}
                    />
                    <span className="visual-tag">
                      <span />
                      {config.color}
                    </span>
                  </div>
                  <div className="product-config">
                    <div className="field-label">
                      <label>外观颜色</label>
                      <span>选择你的偏好</span>
                    </div>
                    <div
                      className="color-options"
                      role="group"
                      aria-label="外观颜色"
                    >
                      {COLORS.map((color) => (
                        <button
                          key={color}
                          disabled={editingDisabled}
                          className={`color-option ${config.color === color ? "chosen" : ""}`}
                          aria-pressed={config.color === color}
                          onClick={() => update("color", color)}
                        >
                          <span
                            className={`swatch ${color === "夜空色" ? "night" : "white"}`}
                          />
                          {color}
                          {config.color === color && <Check size={14} />}
                        </button>
                      ))}
                    </div>
                    <div className="field-label capacity-label">
                      <label>存储容量</label>
                      <span>每次限购 1 台</span>
                    </div>
                    <div
                      className="capacity-options"
                      role="group"
                      aria-label="存储容量"
                    >
                      {CAPACITIES.map((capacity) => (
                        <button
                          key={capacity}
                          disabled={editingDisabled}
                          className={
                            config.capacity === capacity ? "chosen" : ""
                          }
                          aria-pressed={config.capacity === capacity}
                          onClick={() => {
                            update("capacity", capacity);
                            update("maxTotal", REFERENCE_PRICES[capacity]);
                          }}
                        >
                          {capacity}
                        </button>
                      ))}
                    </div>
                    <div className="product-price">
                      <span>
                        官网参考价<small>以结账页面为准</small>
                      </span>
                      <strong>
                        <span>¥</span>
                        {yuan(REFERENCE_PRICES[config.capacity])}
                      </strong>
                    </div>
                  </div>
                  <div className="channel-row">
                    <span className="apple-icon">
                      <Globe2 size={16} />
                    </span>
                    <span>
                      {platform.name}<small>{platform.host}</small>
                    </span>
                    <ShieldCheck size={16} />
                  </div>
                </section>

                <div className="execution-column">
                  <section
                    className="schedule-panel"
                    aria-labelledby="schedule-title"
                  >
                    <div className="panel-topline">
                      <span className="section-number">02</span>
                      <span id="schedule-title">开售计划</span>
                      <span className="timezone">UTC +08:00</span>
                    </div>
                    <div className="countdown-heading">
                      <span className="live-marker">
                        <i />
                        {remaining > 0 ? "距离计划开始" : "已到计划开始时间"}
                      </span>
                      <span>北京时间</span>
                    </div>
                    <div
                      className="countdown"
                      aria-label={`距离计划开始 ${countdown[0]} 天 ${countdown[1]} 小时 ${countdown[2]} 分 ${countdown[3]} 秒`}
                    >
                      {countdown.map((number, index) => (
                        <div className="countdown-unit" key={index}>
                          <strong>{String(number).padStart(2, "0")}</strong>
                          <span>{["天", "小时", "分钟", "秒"][index]}</span>
                          {index < 3 && <b>:</b>}
                        </div>
                      ))}
                    </div>
                    <label className="datetime-field">
                      <CalendarClock size={17} />
                      <span>计划时间</span>
                      <input
                        aria-label="计划开售时间（北京时间）"
                        type="datetime-local"
                        value={beijingInput(config.launchAt)}
                        disabled={editingDisabled}
                        onChange={(event) => {
                          if (event.target.value)
                            update(
                              "launchAt",
                              `${event.target.value}:00+08:00`,
                            );
                        }}
                      />
                      <ChevronDown size={14} />
                    </label>
                    <div className="source-note">
                      {config.platform === "apple" ? "默认时间来自" : "初始时间参考"}
                      <a
                        href={DEFAULT_SETTINGS.productUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Apple 预购公告
                        <ExternalLink size={10} />
                      </a>
                      {config.platform === "apple" ? "；使用本机时钟。" : "；请按该平台公告设置。"}
                    </div>
                  </section>

                  <section
                    className="automation-panel"
                    aria-labelledby="automation-title"
                  >
                    <div className="panel-topline">
                      <span className="section-number">03</span>
                      <span id="automation-title">执行设置</span>
                      <span className="mode-label">
                        {config.autoSubmit ? "自动提交" : "辅助下单"}
                      </span>
                    </div>
                    <div className="budget-row">
                      <label htmlFor="budget">
                        订单总价上限<span>包含商品与其他费用</span>
                      </label>
                      <div className="money-input">
                        <span>¥</span>
                        <input
                          id="budget"
                          type="number"
                          min="1"
                          max="100000"
                          step="1"
                          value={config.maxTotal || ""}
                          disabled={editingDisabled}
                          onChange={(event) =>
                            update("maxTotal", Number(event.target.value))
                          }
                        />
                      </div>
                    </div>
                    <div className="setting-row">
                      <div>
                        <label htmlFor="auto-submit">自动提交订单</label>
                        <p>核对配置、数量和总价后，尝试提交一次。</p>
                      </div>
                      <label className="switch">
                        <input
                          id="auto-submit"
                          type="checkbox"
                          checked={config.autoSubmit}
                          disabled={editingDisabled}
                          onChange={(event) =>
                            update("autoSubmit", event.target.checked)
                          }
                        />
                        <span />
                      </label>
                    </div>
                    <div className="setting-inline">
                      <label htmlFor="poll">
                        页面读取{" "}
                        <select
                          id="poll"
                          value={config.pollSeconds}
                          disabled={editingDisabled}
                          onChange={(event) =>
                            update("pollSeconds", Number(event.target.value))
                          }
                        >
                          {[3, 5, 10, 15, 30, 60].map((value) => (
                            <option key={value} value={value}>
                              {value} 秒
                            </option>
                          ))}
                          {![3, 5, 10, 15, 30, 60].includes(
                            config.pollSeconds,
                          ) && (
                            <option value={config.pollSeconds}>
                              {config.pollSeconds} 秒
                            </option>
                          )}
                        </select>
                      </label>
                      <span />
                      <label htmlFor="duration">
                        最长运行{" "}
                        <select
                          id="duration"
                          value={config.maxMinutes}
                          disabled={editingDisabled}
                          onChange={(event) =>
                            update("maxMinutes", Number(event.target.value))
                          }
                        >
                          {[5, 10, 20, 30, 60, 120].map((value) => (
                            <option key={value} value={value}>
                              {value} 分钟
                            </option>
                          ))}
                          {![5, 10, 20, 30, 60, 120].includes(
                            config.maxMinutes,
                          ) && (
                            <option value={config.maxMinutes}>
                              {config.maxMinutes} 分钟
                            </option>
                          )}
                        </select>
                      </label>
                    </div>
                    <div className="setting-inline">
                      <label htmlFor="refresh">日常刷新{" "}
                        <select id="refresh" value={config.refreshSeconds} disabled={editingDisabled} onChange={(event) => update("refreshSeconds", Number(event.target.value))}>
                          {[60, 120, 180, 300, 600].map((value) => <option key={value} value={value}>{value} 秒</option>)}
                          {![60, 120, 180, 300, 600].includes(config.refreshSeconds) && <option value={config.refreshSeconds}>{config.refreshSeconds} 秒</option>}
                        </select>
                      </label><span />
                      <label htmlFor="launch-refresh">开售刷新{" "}
                        <select id="launch-refresh" value={config.launchRefreshSeconds} disabled={editingDisabled} onChange={(event) => update("launchRefreshSeconds", Number(event.target.value))}>
                          {[15, 30, 60, 120].map((value) => <option key={value} value={value}>{value} 秒</option>)}
                          {![15, 30, 60, 120].includes(config.launchRefreshSeconds) && <option value={config.launchRefreshSeconds}>{config.launchRefreshSeconds} 秒</option>}
                        </select>
                      </label>
                    </div>
                    <p className="refresh-note">页面读取只检查当前内容；整页刷新单独计时，开售前后 2 分钟使用开售间隔。网站自身更新也可能联网。</p>
                    <div className="launch-actions">
                      {active ? (
                        <>
                          <button
                            className="button primary main-cta"
                            disabled={disabled}
                            onClick={() =>
                              action("focus", () => api("browser/open"))
                            }
                          >
                            <Monitor size={16} />
                            查看执行浏览器
                            <ArrowUpRight size={16} />
                          </button>
                          <button
                            className="button stop-button"
                            disabled={disabled}
                            onClick={() =>
                              action("stop", () => api("task/stop"))
                            }
                          >
                            {pending === "stop" ? (
                              <LoaderCircle size={15} className="spin" />
                            ) : (
                              <Square size={14} />
                            )}
                            停止
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="button primary main-cta"
                            disabled={disabled || locked || missing.length > 0}
                            onClick={() => requestStart("scheduled")}
                          >
                            {pending === "start" ? (
                              <LoaderCircle size={17} className="spin" />
                            ) : (
                              <Zap size={17} />
                            )}
                            {remaining > 0 ? "启动定时任务" : "启动购买任务"}
                            <ArrowRight size={18} />
                          </button>
                          <button
                            className="button run-now"
                            title="跳过倒计时，立即执行真实购买流程"
                            disabled={disabled || locked || missing.length > 0}
                            onClick={() => requestStart("immediate")}
                          >
                            <Play size={14} />
                            立即执行
                          </button>
                        </>
                      )}
                    </div>
                    <p className="awake-note">
                      <Clock3 size={12} />
                      定时任务需保持本应用、浏览器和电脑开启。
                    </p>
                  </section>
                </div>
              </div>

              {state && state.runPlatforms.length > 0 && <section className="channel-monitor" aria-label="各平台运行状态">
                {state.runPlatforms.map((id) => {
                  const channel = state.channels[id];
                  const needsUser = ["awaiting_user", "ready"].includes(channel.phase);
                  return <div className={`channel-monitor-row ${state.winner === id ? "winner" : ""}`} key={id}>
                    <strong>{PLATFORM_INFO[id].shortName}{state.winner === id && <small>{state.winnerProductUrl ? <a href={state.winnerProductUrl} target="_blank" rel="noreferrer">当前购买商品 ↗</a> : "当前购买渠道"}</small>}</strong>
                    <div><span>{PHASE_LABELS[channel.phase]} · 读取 {channel.attempt} 次</span><p>{channel.message}</p>
                      {channel.cooldownUntil && Date.parse(channel.cooldownUntil) > now ? <small className="channel-timing">冷却至 {time(channel.cooldownUntil)} · 剩余 {Math.ceil((Date.parse(channel.cooldownUntil) - now) / 1000)} 秒</small> : channel.nextRefreshAt && <small className="channel-timing">上次页面导航 {channel.lastRefreshAt ? time(channel.lastRefreshAt) : "—"} · 计划刷新 {time(channel.nextRefreshAt)}</small>}
                    </div>
                    <button className="text-button" disabled={disabled} onClick={() => action(`focus-${id}`, () => api("browser/open", { platform: id }))}>查看浏览器<ArrowUpRight size={12} /></button>
                    {active && needsUser && <button className="small-action" disabled={disabled || (!!channel.cooldownUntil && Date.parse(channel.cooldownUntil) > now)} onClick={() => action(`resume-${id}`, () => api("task/resume", { platform: id }))}>已操作，继续</button>}
                  </div>;
                })}
              </section>}

              <section
                className={`execution-strip ${awaiting ? "attention" : ""}`}
                aria-live="polite"
              >
                <div
                  className={`execution-symbol ${active && !awaiting ? "running" : ""}`}
                >
                  {awaiting ? (
                    <Bell size={20} />
                  ) : phase === "completed" ? (
                    <CheckCheck size={20} />
                  ) : active ? (
                    <Radio size={20} />
                  ) : (
                    <Terminal size={20} />
                  )}
                </div>
                <div className="execution-message">
                  <div>
                    <h3>{PHASE_LABELS[phase]}</h3>
                    <span>
                      {state?.runId
                        ? `任务 ${state.runId.slice(0, 8).toUpperCase()}`
                        : "尚未创建执行任务"}
                    </span>
                  </div>
                  <p>{state?.message ?? "连接本地服务后即可开始。"}</p>
                </div>
                {awaiting ? (
                  <button
                    className="button primary compact"
                    disabled={disabled || resumeCooling}
                    onClick={() => action("resume", () => api("task/resume"))}
                  >
                    已操作，继续
                    <ArrowRight size={14} />
                  </button>
                ) : (
                  <span className="attempt-count">
                    {state?.attempt ?? 0}
                    <small>检查次数</small>
                  </span>
                )}
              </section>

              {locked && (
                <div className="submission-note">
                  <ShieldCheck size={17} />
                  <div>
                    <strong>已有订单提交记录</strong>
                    <p>
                      本次提交结果
                      {state.submission?.result === "confirmed"
                        ? "已识别平台确认页"
                        : "尚未确认"}
                      。记录适用于全部渠道；重新执行前请先在对应平台核对订单。
                    </p>
                  </div>
                  <button
                    className="text-button"
                    disabled={disabled || active}
                    onClick={() => {
                      setAccepted(false);
                      setConfirm("resolve");
                    }}
                  >
                    复核提交记录
                    <ArrowUpRight size={13} />
                  </button>
                </div>
              )}

              <div className="bottom-grid">
                <section className="preparation-section">
                  <div className="section-heading">
                    <h3>开售前准备</h3>
                    <button
                      className="text-button"
                      onClick={() => setTab("help")}
                    >
                      查看指南
                      <ArrowUpRight size={12} />
                    </button>
                  </div>
                  <div className="preparation-item">
                    <span className="prep-index">1</span>
                    <div>
                      <strong>登录{platform.name}账户 · {currentLogin.label}</strong>
                      <p>{currentLogin.state === "logged_in" ? "已在执行页面检测到登录，请提前核对收货信息。" : extensionMode ? "请查看上方登录状态，在接入的 Chrome 标签页完成登录。" : "请查看上方登录状态，在助手执行窗口完成登录。"}</p>
                    </div>
                    <button
                      className="small-action"
                      disabled={disabled}
                      onClick={() =>
                        action("login", () =>
                          showBrowser(),
                        )
                      }
                    >
                      {pending === "login" ? (
                        <LoaderCircle size={13} className="spin" />
                      ) : (
                        <ArrowUpRight size={14} />
                      )}
                      {extensionMode && !currentChannel?.browserOpen ? "接入标签页" : "打开登录"}
                    </button>
                  </div>
                  <div className="preparation-item">
                    <span className="prep-index">2</span>
                    <div>
                      <strong>检查当前渠道购买入口</strong>
                      <p>仅检查页面；不会加购或提交订单。</p>
                    </div>
                    <button
                      className="small-action"
                      disabled={editingDisabled}
                      onClick={() =>
                        action(
                          "inspect",
                          async () => {
                            await save();
                            await api("browser/inspect");
                          },
                          "页面检查完成，请查看运行动态。",
                        )
                      }
                    >
                      {pending === "inspect" ? (
                        <LoaderCircle size={13} className="spin" />
                      ) : (
                        <Globe2 size={13} />
                      )}
                      只读检查
                    </button>
                  </div>
                  {state?.probe && (
                    <div className="probe-note">
                      <Check size={13} />
                      <p>
                        {state.probe.note}
                        <span>最近检查于 {time(state.probe.at)}</span>
                      </p>
                    </div>
                  )}
                </section>
                <section className="activity-section">
                  <div className="section-heading">
                    <h3>
                      <span className="activity-dot" />
                      运行动态
                    </h3>
                    <button
                      className="text-button"
                      onClick={() => setTab("logs")}
                    >
                      全部记录
                      <ArrowUpRight size={12} />
                    </button>
                  </div>
                  {state?.logs.length ? (
                    <div className="mini-logs">
                      {state.logs
                        .slice(-4)
                        .reverse()
                        .map((log) => (
                          <div key={log.id} className="mini-log">
                            <time>{time(log.at)}</time>
                            <i className={`log-dot ${log.level}`} />
                            <p>{log.message}</p>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <div className="empty-activity">
                      <FileClock size={23} />
                      <div>
                        <strong>一切从准备开始</strong>
                        <p>启动任务后，执行动态会显示在这里。</p>
                      </div>
                    </div>
                  )}
                </section>
              </div>
              <section className="workflow" aria-label="购买流程">
                {[
                  "选择配置",
                  "进入购买",
                  "进入结账",
                  "核对订单",
                  "提交订单",
                ].map((label, index) => (
                  <div
                    className={
                      stepIndex >= index
                        ? "workflow-step passed"
                        : "workflow-step"
                    }
                    key={label}
                  >
                    <span>
                      {stepIndex > index ? (
                        <Check size={10} />
                      ) : (
                        String(index + 1).padStart(2, "0")
                      )}
                    </span>
                    {label}
                    {index < 4 && <span className="workflow-line" />}
                  </div>
                ))}
              </section>
            </>
          ) : tab === "logs" ? (
            <section className="logs-view">
              <div className="logs-toolbar">
                <div className="filter-tabs" role="group" aria-label="日志筛选">
                  {[
                    ["all", "全部"],
                    ["success", "完成"],
                    ["warn", "需要关注"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      aria-pressed={logFilter === value}
                      className={logFilter === value ? "selected" : ""}
                      onClick={() => setLogFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span>最近 150 条 · 北京时间</span>
              </div>
              <div className="log-table-header">
                <span>时间</span>
                <span>状态</span>
                <span>执行内容</span>
              </div>
              {logs.length ? (
                [...logs].reverse().map((log) => (
                  <div className="log-table-row" key={log.id}>
                    <time>
                      {new Date(log.at).toLocaleDateString("zh-CN", {
                        timeZone: "Asia/Shanghai",
                        month: "2-digit",
                        day: "2-digit",
                      })}{" "}
                      {time(log.at)}
                    </time>
                    <span className={`log-level ${log.level}`}>
                      {
                        {
                          info: "记录",
                          success: "完成",
                          warn: "关注",
                          error: "异常",
                        }[log.level]
                      }
                    </span>
                    <p>{log.message}</p>
                  </div>
                ))
              ) : (
                <div className="large-empty">
                  <FileClock size={32} />
                  <h3>暂无运行记录</h3>
                  <p>保存配置、检查商品或启动任务后，记录会出现在这里。</p>
                  <button
                    className="button secondary"
                    onClick={() => setTab("workspace")}
                  >
                    返回工作台
                    <ArrowRight size={15} />
                  </button>
                </div>
              )}
            </section>
          ) : (
            <section className="help-view">
              <div className="help-intro">
                <ShieldCheck size={25} />
                <div>
                  <h2>在你的电脑上完成购买准备</h2>
                  <p>
                    默认接入你日常使用的 Chrome，沿用商城登录会话。各渠道分别选择执行标签页。
                  </p>
                </div>
              </div>
              {[
                [
                  "01",
                  "准备各渠道登录",
                  "在日常 Chrome 安装官方 Playwright Extension，点击“连接普通 Chrome”并在扩展页允许连接，然后为各渠道接入对应商城标签页。扩展已连接与商城已登录分别显示；登录状态来自所选页面。淘宝与天猫同商品只需接入天猫。核对收货地址与预约资格；Apple 官网需要空购物袋。",
                ],
                [
                  "02",
                  "设置你的购买目标",
                  "逐个平台填写完整商品详情链接、颜色、容量、预算与开售时间。可先查找商品，在浏览器打开详情页后点击“读取当前商品”。商城开售时间和售价可能与 Apple 官网不同，请以各自公告为准。",
                ],
                [
                  "03",
                  "选择渠道与自动化范围",
                  "选择多平台同时监控，勾选参与渠道。各渠道按自己的计划开始检查，首个可购买渠道进入结账，其余停止。自动提交开关按渠道保存；商品编号、配置、数量和人民币总价全部核对后才会提交。",
                ],
                [
                  "04",
                  "保持电脑与应用开启",
                  "点击“启动定时任务”，在确认窗口核对本次设置。保持电脑唤醒、网络可用、服务与接入的 Chrome 标签页开启。任务依据本机时钟执行，请提前校准 Windows 时间。断开扩展会停止任务并保留网页。“立即执行”会跳过倒计时，进入真实购买流程。",
                ],
                [
                  "05",
                  "按提示完成必要验证",
                  "访问限流时先停止自动访问，按倒计时冷却；结束后在浏览器检查页面，再点击“已操作，继续”。停止或重启不会清除冷却。单个渠道等待验证时，其他渠道仍可监控。抖音需要打开 App 时请在手机完成；定金、尾款和分期流程需人工处理。",
                ],
                [
                  "06",
                  "核对订单结果",
                  "识别到平台确认页与订单号后才显示完成。自动提交或交给人工确认前都会保存记录，此记录同时锁住全部渠道，重启后仍生效。结果不明时不会自动换渠道重试；先检查订单再复核记录。",
                ],
              ].map(([number, title, description]) => (
                <article className="help-step" key={number}>
                  <span>{number}</span>
                  <div>
                    <h3>{title}</h3>
                    <p>{description}</p>
                  </div>
                </article>
              ))}
              <div className="help-detail">
                <CircleHelp size={17} />
                <p>
                  各平台真实下单与付款流程尚未验证。页面无法识别时会暂停，可在该渠道的“高级适配”中配置唯一控件。京东不同规格可能对应不同商品编号，请使用目标规格的链接。支付验证码需自行完成。
                </p>
              </div>
              <a
                href={config.productUrl || platform.searchUrl}
                target="_blank"
                rel="noreferrer"
                className="text-button"
              >
                查看当前渠道商品
                <ArrowUpRight size={14} />
              </a>
            </section>
          )}
          <footer className="page-footer">
            <span>
              <span className="footer-brand">duo.</span> 首发助手
            </span>
            <p>本地运行 · 1 台目标 · 每次提交可追溯</p>
            <span className="footer-clock">
              {time(new Date(now).toISOString())} <span>CST</span>
            </span>
          </footer>
        </main>
      </div>

      {toast && (
        <div
          className={`toast ${toast.error ? "error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          {toast.error ? <CircleHelp size={17} /> : <Check size={17} />}
          <span>{toast.text}</span>
          <button aria-label="关闭提示" onClick={() => setToast(null)}>
            <X size={15} />
          </button>
        </div>
      )}
      {confirm && (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setConfirm(null);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
          >
            <button
              className="modal-close icon-button"
              autoFocus
              aria-label="关闭确认窗口"
              onClick={() => setConfirm(null)}
            >
              <X size={19} />
            </button>
            <span className="modal-symbol">
              {confirm === "resolve" ? (
                <ShieldCheck size={24} />
              ) : (
                <CalendarClock size={24} />
              )}
            </span>
            <h2 id="confirm-title">
              {confirm === "resolve"
                ? "复核订单提交记录"
                : confirm === "immediate"
                  ? "立即执行购买任务"
                  : "确认首发计划"}
            </h2>
            {confirm === "resolve" ? (
              <p className="modal-description">
                请先在对应平台订单列表中核对是否已产生订单、是否需要付款。解除后所有渠道都可以重新执行购买流程。
              </p>
            ) : (
              <>
                <p className="modal-description">
                  核对各渠道设置。启动后会操作真实商城页面，首个可购买渠道进入结账，其余停止。
                </p>
                <dl className="review-details">
                  <div><dt>执行渠道</dt><dd>{mode === "race" ? `${planned.length} 个渠道同时监控` : platform.name}</dd></div>
                  {mode === "race" && planned.map((plan) => <div key={plan.platform}><dt>{PLATFORM_INFO[plan.platform].shortName}</dt><dd>{plan.color} / {plan.capacity} / ¥{yuan(plan.maxTotal)}<small className="review-channel-detail">{confirm === "immediate" ? "立即开始" : beijingInput(plan.launchAt).replace("T", " ")} · {plan.autoSubmit ? "自动提交" : "人工确认"}</small></dd></div>)}
                  <div>
                    <dt>购买目标</dt>
                    <dd>
                      {mode === "race" ? "iPhone Duo（规格见各渠道设置）" : `iPhone Duo · ${config.color} · ${config.capacity}`}
                    </dd>
                  </div>
                  <div>
                    <dt>购买数量</dt>
                    <dd>1 台</dd>
                  </div>
                  {mode === "single" && <div>
                    <dt>总价上限</dt>
                    <dd>¥{yuan(config.maxTotal)}</dd>
                  </div>}
                  <div>
                    <dt>开始时间</dt>
                    <dd>
                      {confirm === "immediate"
                        ? "立即开始"
                        : mode === "race" ? "按各渠道的北京时间计划执行" : `${beijingInput(config.launchAt).replace("T", " ")}（北京时间）`}
                    </dd>
                  </div>
                  <div>
                    <dt>执行方式</dt>
                    <dd className={anyAuto ? "accent-text" : ""}>
                      {mode === "race" ? "按上述各渠道设置，全程仅尝试一笔订单" : config.autoSubmit
                        ? "核对通过后自动提交一次"
                        : "推进结账，由我确认下单"}
                    </dd>
                  </div>
                </dl>
              </>
            )}
            <label className="acceptance">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(event) => setAccepted(event.target.checked)}
              />
              <span>
                {confirm === "resolve"
                  ? "我已在对应平台核对订单结果，并确认要解除全部渠道共用的重试锁。"
                  : anyAuto
                    ? "我确认各渠道配置与预算，允许已开启自动提交的渠道在核对通过后提交一次订单。"
                    : "我已核对各渠道配置，结账时由我在平台确认下单。"}
              </span>
            </label>
            <button
              className="button primary modal-primary"
              disabled={!accepted || disabled}
              onClick={start}
            >
              {confirm === "resolve" ? "确认已核对" : "确认并启动"}
              <ArrowRight size={17} />
            </button>
          </section>
        </div>
      )}
      {advanced && (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setAdvanced(false);
          }}
        >
          <section
            className="modal advanced-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="advanced-title"
          >
            <button
              className="modal-close icon-button"
              autoFocus
              aria-label="关闭高级适配"
              onClick={() => setAdvanced(false)}
            >
              <X size={19} />
            </button>
            <span className="eyebrow">ADVANCED</span>
            <h2 id="advanced-title">{platform.shortName}页面适配</h2>
            <p className="modal-description">
              默认按平台可见控件识别。页面无法识别时填写唯一 CSS
              选择器；留空使用默认识别。选择器仍需通过订单核对。
            </p>
            <label className="advanced-field">
              购买链接
              <input
                value={config.productUrl}
                onChange={(event) => update("productUrl", event.target.value)}
              />
            </label>
            <label className="advanced-field">指定店铺（可选，结账时核对完整名称）<input value={config.expectedSeller} placeholder="留空按商品编号核对" onChange={(event) => update("expectedSeller", event.target.value)} /></label>
            <div className="selectors-grid">
              {(
                [
                  ["color", "颜色控件"],
                  ["capacity", "容量控件"],
                  ["addToBag", config.platform === "apple" ? "加入购物袋按钮" : "立即购买按钮"],
                  ["checkout", "结账按钮"],
                  ["submit", "提交订单按钮"],
                  ["total", "订单总价数值"],
                  ["lineItems", "每件商品的外层容器"],
                  ["quantity", "商品条目内的数量"],
                  ["seller", "订单店铺名称"],
                  ["productTitle", "商品页标题"],
                ] as [keyof Selectors, string][]
              ).map(([key, label]) => (
                <label className="advanced-field" key={key}>
                  {label}
                  <input
                    placeholder="自动识别"
                    value={config.selectors[key]}
                    onChange={(event) =>
                      update("selectors", {
                        ...config.selectors,
                        [key]: event.target.value,
                      })
                    }
                    spellCheck={false}
                  />
                </label>
              ))}
            </div>
            <label className="setting-row advanced-notification">
              <div>
                <strong>任务状态提醒</strong>
                <p>需要接手或识别订单确认时发送系统通知。</p>
              </div>
              <span className="switch">
                <input
                  type="checkbox"
                  checked={config.notifications}
                  onChange={(event) =>
                    update("notifications", event.target.checked)
                  }
                />
                <span />
              </span>
            </label>
            <button
              className="button primary modal-primary"
              disabled={editingDisabled}
              onClick={async () => {
                setPending("save");
                try {
                  await save();
                  setAdvanced(false);
                  notify("高级适配已保存。");
                } catch (error) {
                  notify(
                    String(error instanceof Error ? error.message : error),
                    true,
                  );
                } finally {
                  setPending("");
                }
              }}
            >
              保存适配
              <Check size={16} />
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
