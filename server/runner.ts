import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { AppleBrowser, NeedsUser, browserRuntime } from "./browser.ts";
import { AccessGuard } from "./access.ts";
import { deduplicatePlans, refreshInterval, networkBackoff } from "./monitoring.ts";
import { createBrowser } from "./marketplace.ts";
import { unknownLogin } from "./login.ts";
import { ExtensionConnection, type ExtensionConnector } from "./extension.ts";
import { persistLog, writeJson, validateBrowserConnection } from "./store.ts";
import { assertRunnable, fingerprint, validateOrder, validateWorkspace } from "./safety.ts";
import {
  PLATFORMS, PLATFORM_INFO, LOGIN_STATUS_TTL, defaultWorkspace,
  type AppState, type Settings, type LogEntry, type Level, type Phase,
  type Submission, type Platform, type RunMode, type BrowserConnectionConfig, type BrowserMode,
} from "../shared/types.ts";

type Candidate = { settings: Settings; browser: AppleBrowser; button: NonNullable<Awaited<ReturnType<AppleBrowser["addButton"]>>>; signal: AbortSignal };

export class TaskRunner {
  state: AppState;
  private browserGroups = { managed: new Map<Platform, AppleBrowser>(), extension: new Map<Platform, AppleBrowser>() };
  private get browsers() { return this.browserGroups[this.state.browserConnection.mode]; }
  readonly extension: ExtensionConnection;
  private controller: AbortController | null = null;
  private candidates = new Map<Platform, AbortController>();
  private loop: Promise<void> | null = null;
  private resumeAction: (() => void) | null = null;
  private channelResumes = new Map<Platform, () => void>();
  private listeners = new Set<() => void>();
  private loginChecks = new Map<Platform, { revision: number; browser: AppleBrowser; work: Promise<void> }>();
  private loginRevisions = new Map<Platform, number>();

  constructor(settings: Settings, logs: LogEntry[], submission: Submission | null, workspace = defaultWorkspace(settings), private browserFactory = createBrowser, readonly access = new AccessGuard(), connection: BrowserConnectionConfig = { version: 1, mode: "managed", profileDirectory: null }, extensionConnector?: ExtensionConnector) {
    this.extension = new ExtensionConnection(() => {
      if (!this.extension.connected) {
        for (const browser of this.browserGroups.extension.values()) void browser.close();
        for (const platform of PLATFORMS) this.state.channels[platform].extensionTab = null;
      }
      this.state.browserConnection.extension = { ...this.extension.state };
      this.publish();
    }, extensionConnector);
    this.state = {
      settings, workspace, logs, submission,
      channels: Object.fromEntries(PLATFORMS.map((platform) => [platform, {
        phase: "idle", message: workspace.plans[platform].productUrl ? "等待启动" : "待配置商品详情链接",
        attempt: 0, browserOpen: false, login: unknownLogin(), extensionTab: null, nextCheckAt: null, probe: null,
        cooldownUntil: null, restriction: null, lastRefreshAt: null, nextRefreshAt: null, mergedInto: null,
      }])) as AppState["channels"],
      runPlatforms: [], winner: null, winnerProductUrl: null, phase: "idle",
      message: "选择购买渠道，准备登录与商品链接，即可启动首发任务。",
      runId: null, attempt: 0, startedAt: null, nextCheckAt: null, lastCheckAt: null,
      browserOpen: false, browserBusy: false, browserName: connection.mode === "extension" ? "Chrome · 普通浏览器扩展" : browserRuntime().name,
      browserConnection: { ...connection, extension: { ...this.extension.state } }, serverNow: new Date().toISOString(), probe: null,
    };
    this.access.subscribe(() => { this.syncAccess(); this.publish(); });
    this.syncAccess();
  }

  private syncAccess() {
    for (const platform of PLATFORMS) {
      const hold = this.access.restriction(platform);
      this.state.channels[platform].cooldownUntil = hold?.until ?? null;
      this.state.channels[platform].restriction = this.access.issue(platform);
    }
  }

  get browser() { return this.getBrowser(this.state.winner ?? this.state.settings.platform); }
  set browser(browser: AppleBrowser) {
    browser.access = this.access;
    this.browsers.set(this.state.settings.platform, browser);
    this.state.channels[this.state.settings.platform].browserOpen = browser.isOpen;
    this.state.browserOpen = browser.isOpen;
    this.watchLogin(this.state.settings.platform, browser);
  }
  private watchLogin(platform: Platform, browser: AppleBrowser) {
    browser.onSessionChange = () => {
      if (browser.mode !== this.state.browserConnection.mode) return;
      this.invalidateLogin(platform, browser.isOpen);
      if (browser.isOpen) void this.refreshLogin(platform);
    };
  }
  private invalidateLogin(platform: Platform, open: boolean) {
    this.loginRevisions.set(platform, (this.loginRevisions.get(platform) ?? 0) + 1);
    this.state.channels[platform].login = unknownLogin(open ? "page_changed" : "browser_closed");
    this.publish();
  }
  async refreshLogin(platform: Platform): Promise<void> {
    const pending = this.loginChecks.get(platform);
    if (pending) {
      await pending.work;
      if (this.loginChecks.get(platform) === pending) this.loginChecks.delete(platform);
      // A rebind or mode change must read the newly selected session rather than
      // coalescing into a read from the previous page.
      if ((this.loginRevisions.get(platform) ?? 0) !== pending.revision || this.browsers.get(platform) !== pending.browser)
        return this.refreshLogin(platform);
      return;
    }
    const browser = this.browsers.get(platform);
    // Never create an execution window or navigate just to inspect login state.
    if (!browser?.isOpen) { this.invalidateLogin(platform, false); return; }
    const revision = this.loginRevisions.get(platform) ?? 0;
    const work = (async () => {
      const login = await browser.checkLogin();
      if ((this.loginRevisions.get(platform) ?? 0) !== revision) return;
      this.state.channels[platform].login = browser.isOpen ? login : unknownLogin();
      this.publish();
    })();
    const check = { revision, browser, work };
    this.loginChecks.set(platform, check);
    try { await work; } finally { if (this.loginChecks.get(platform) === check) this.loginChecks.delete(platform); }
  }
  async refreshLogins() {
    for (const [platform, browser] of this.browsers) {
      if (browser.isOpen) await this.refreshLogin(platform);
    }
  }
  getBrowser(platform: Platform) {
    const mode = this.state.browserConnection.mode;
    let browser = this.browsers.get(platform);
    if (!browser) {
      browser = this.browserFactory(platform, (open) => {
        if (this.state.browserConnection.mode !== mode) return;
        this.state.channels[platform].browserOpen = open;
        if (!open) {
          if (mode === "extension") this.state.channels[platform].extensionTab = null;
          this.invalidateLogin(platform, false);
        }
        if (platform === (this.state.winner ?? this.state.settings.platform)) this.state.browserOpen = open;
        if (!open && this.active) {
          if (this.state.winner === platform || this.state.runPlatforms.length === 1) this.controller?.abort();
          else this.candidates.get(platform)?.abort();
        }
        this.publish();
      });
      browser.access = this.access;
      browser.mode = mode;
      this.browsers.set(platform, browser);
      this.watchLogin(platform, browser);
    }
    return browser;
  }
  async closeBrowsers() {
    await Promise.allSettled(Object.values(this.browserGroups).flatMap((browsers) => [...browsers.values()].map((browser) => browser.close())));
    await this.extension.disconnect();
  }
  async configureBrowser(input: unknown) {
    if (this.active) throw new Error("请先停止任务再切换浏览器连接方式。");
    const config = validateBrowserConnection(input);
    const previous = this.state.browserConnection;
    if (config.mode !== previous.mode || config.profileDirectory !== previous.profileDirectory) await this.extension.disconnect();
    await writeJson("browser-connection.json", config);
    this.state.browserConnection = { ...config, extension: { ...this.extension.state } };
    this.state.browserName = config.mode === "extension" ? "Chrome · 普通浏览器扩展" : browserRuntime().name;
    for (const platform of PLATFORMS) {
      const open = !!this.browsers.get(platform)?.isOpen;
      this.state.channels[platform].browserOpen = open;
      this.invalidateLogin(platform, open);
    }
    this.state.browserOpen = this.state.channels[this.state.winner ?? this.state.settings.platform].browserOpen;
    this.publish();
    await this.refreshLogins();
  }
  connectExtension() {
    if (this.active) throw new Error("请先停止任务再连接浏览器。");
    if (this.state.browserConnection.mode !== "extension") throw new Error("请先选择普通浏览器扩展模式。");
    this.extension.begin(this.state.browserConnection.profileDirectory);
  }
  async disconnectExtension() {
    await this.stop();
    await this.extension.disconnect();
  }
  async bindExtensionTab(platform: Platform, id: string) {
    if (this.active) throw new Error("请先停止任务再接入其他标签页。");
    if (this.state.browserConnection.mode !== "extension") throw new Error("请先选择普通浏览器扩展模式。");
    const page = this.extension.resolve(platform, id);
    for (const [owner, browser] of this.browserGroups.extension) {
      if (owner !== platform && browser.ownsPage(page)) throw new Error("此标签页已接入其他渠道，请为当前渠道选择另一个标签页。淘宝／天猫同商品只需接入天猫。");
    }
    const browser = this.getBrowser(platform);
    await browser.attachExtensionPage(page);
    this.state.channels[platform].extensionTab = (await this.extension.list(platform)).find((tab) => tab.id === id) ?? null;
    await this.refreshLogin(platform);
    this.log("info", "已接入你选择的普通浏览器标签页；沿用该窗口的登录会话。", platform);
  }
  get active() { return this.controller !== null; }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  snapshot() {
    this.syncAccess();
    for (const platform of PLATFORMS) {
      const channel = this.state.channels[platform];
      if (channel.login.state !== "unknown" && (!this.browsers.get(platform)?.isOpen ||
        !channel.login.checkedAt || Date.now() - Date.parse(channel.login.checkedAt) > LOGIN_STATUS_TTL))
        channel.login = { ...unknownLogin(channel.browserOpen ? "stale" : "browser_closed"), checkedAt: channel.login.checkedAt };
    }
    return { ...this.state, serverNow: new Date().toISOString() };
  }
  publish() { for (const listener of this.listeners) listener(); }
  phase(phase: Phase, message: string) {
    this.state.phase = phase; this.state.message = message;
    if (this.state.winner) Object.assign(this.state.channels[this.state.winner], { phase, message });
    this.publish();
  }
  log(level: Level, message: string, platform?: Platform) {
    const entry: LogEntry = { id: randomUUID(), at: new Date().toISOString(), level,
      message: platform ? `[${PLATFORM_INFO[platform].name}] ${message}` : message };
    this.state.logs = [...this.state.logs.slice(-149), entry];
    persistLog(entry).catch(() => console.error("运行日志写入失败，请检查磁盘空间。"));
    this.publish();
  }

  async save(settings: Settings, mode: RunMode = this.state.workspace.mode, enabledPlatforms = this.state.workspace.enabledPlatforms) {
    if (this.active) throw new Error("任务运行期间不能修改配置，请先停止任务。");
    const workspace = validateWorkspace({ ...this.state.workspace, mode, enabledPlatforms,
      activePlatform: settings.platform, plans: { ...this.state.workspace.plans, [settings.platform]: settings } });
    await writeJson("workspace.json", workspace);
    this.state.workspace = workspace; this.state.settings = workspace.plans[settings.platform];
    this.state.probe = this.state.channels[settings.platform].probe;
    this.state.browserOpen = this.getBrowser(settings.platform).isOpen;
    this.log("info", "购买配置已保存到本机。", settings.platform);
  }
  async switchPlatform(platform: Platform) {
    if (this.active) throw new Error("请先停止任务再切换编辑平台。");
    const workspace = { ...this.state.workspace, activePlatform: platform };
    await writeJson("workspace.json", workspace);
    this.state.workspace = workspace; this.state.settings = workspace.plans[platform];
    this.state.browserOpen = this.getBrowser(platform).isOpen;
    this.state.probe = this.state.channels[platform].probe;
    this.publish();
  }
  async captureProduct() {
    if (this.active) throw new Error("请先停止任务再读取商品链接。");
    const productUrl = await this.getBrowser(this.state.settings.platform).captureProductUrl();
    await this.save({ ...this.state.settings, productUrl });
    return this.state.settings;
  }
  async inspect() {
    if (this.active) throw new Error("任务运行中，请先停止任务再检查页面。");
    assertRunnable(this.state.settings);
    const browser = this.getBrowser(this.state.settings.platform);
    const probe = await browser.probe(this.state.settings);
    this.state.probe = probe; this.state.channels[probe.platform].probe = probe;
    this.log("info", probe.note, probe.platform);
  }
  async reviewAccess(platform: Platform) {
    if (this.active) throw new Error("任务运行中，请使用对应渠道的“已操作，继续”。");
    this.access.acknowledge(platform); await this.access.flush();
    this.syncAccess(); this.log("info", "已确认完成页面检查；下一次访问仍会重新检查验证状态。", platform);
  }

  start(immediate: boolean) {
    if (this.active) throw new Error("已有任务运行，请先停止当前任务。");
    if (this.state.submission && !this.state.submission.resolved)
      throw new Error("存在一次订单提交记录。请先在对应平台核对订单，再复核提交记录；该记录对所有平台生效。");
    const workspace = this.state.workspace;
    const platforms = workspace.mode === "race" ? workspace.enabledPlatforms : [workspace.activePlatform];
    const requested = platforms.map((platform) => structuredClone(workspace.plans[platform]));
    requested.forEach(assertRunnable);
    const { plans, merged } = deduplicatePlans(requested);
    if (this.state.browserConnection.mode === "extension") {
      if (!this.extension.connected) throw new Error("请先连接普通浏览器扩展，再启动任务。");
      const missing = plans.filter((plan) => !this.browsers.get(plan.platform)?.isOpen);
      if (missing.length) throw new Error(`请先接入${missing.map((plan) => PLATFORM_INFO[plan.platform].name).join("、")}的标签页。`);
    }
    const controller = new AbortController();
    this.controller = controller;
    this.state.runPlatforms = [...platforms]; this.state.winner = null; this.state.winnerProductUrl = null;
    this.state.runId = randomUUID(); this.state.startedAt = new Date().toISOString();
    this.state.attempt = 0; this.state.lastCheckAt = null;
    platforms.forEach((platform) => Object.assign(this.state.channels[platform], {
      phase: "scheduled", message: "准备打开商品页面", attempt: 0, nextCheckAt: null,
      lastRefreshAt: null, nextRefreshAt: null, mergedInto: merged[platform] ?? null,
    }));
    for (const [source, target] of Object.entries(merged)) Object.assign(this.state.channels[source as Platform], {
      phase: "merged", message: `相同商品已合并到${PLATFORM_INFO[target].name}，使用该渠道的执行页面。`,
    });
    this.phase("scheduled", plans.length > 1 ? "正在准备多个平台的执行页面。首个可购买渠道进入结账，其余暂停。" : "正在准备购买任务。");
    this.log("info", `${immediate ? "立即执行" : "定时任务已启动"}：${platforms.map((p) => PLATFORM_INFO[p].name).join("、")}；全程最多尝试提交一笔订单。`);
    if (Object.keys(merged).length) this.log("info", `重复商品已合并，实际启动 ${plans.length} 个监控任务。淘宝／天猫共享访问限制与导航节奏。`);
    this.loop = this.executeCampaign(plans, immediate, controller.signal).catch((error) => {
      if (controller.signal.aborted) {
        this.phase("stopped", "任务已停止，各平台浏览器保留当前页面。"); this.log("info", "任务已停止。");
      } else {
        const message = error instanceof NeedsUser ? error.message : error?.name === "TimeoutError" ? "已达到所选渠道最长运行时间，请核对平台订单后决定是否重启。" : "执行遇到异常。请检查各平台浏览器、网络和高级适配。";
        this.phase("error", message); this.log("error", message);
      }
    }).finally(() => {
      this.controller = null; this.resumeAction = null; this.channelResumes.clear(); this.candidates.clear(); this.state.nextCheckAt = null;
      for (const platform of platforms) {
        const channel = this.state.channels[platform]; channel.nextCheckAt = null; channel.nextRefreshAt = null;
        if (channel.mergedInto) continue;
        if (platform !== this.state.winner && !["error", "completed"].includes(channel.phase)) {
          channel.phase = "stopped"; channel.message = this.state.winner ? "其他渠道已进入结账，此渠道已停止。" : "任务已停止。";
        }
      }
      this.publish();
    });
  }
  async stop() { this.controller?.abort(); await this.loop; }
  resume(platform?: Platform) {
    const selected = platform ?? this.state.winner ?? this.state.settings.platform;
    if (this.access.remaining(selected) > 0) throw new NeedsUser("此渠道仍在冷却，请等待冷却结束后再继续。");
    if (this.resumeAction && (!platform || platform === this.state.winner)) { this.browser.clearIntervention(); this.resumeAction(); return; }
    const target = platform ?? (this.channelResumes.size === 1 ? [...this.channelResumes.keys()][0] : this.state.settings.platform);
    const action = this.channelResumes.get(target);
    if (!action) throw new Error("请选择正在等待人工操作的渠道，完成操作后继续。");
    this.getBrowser(target).clearIntervention(); action();
  }
  async resolveSubmission() {
    if (this.active) throw new Error("请先停止任务，再复核订单提交记录。");
    if (!this.state.submission) return;
    const record = { ...this.state.submission, resolved: true };
    await writeJson("submission.json", record); this.state.submission = record;
    this.log("warn", "用户已核对平台订单，解除此次提交记录对所有渠道的重试锁。");
  }

  private channelPhase(platform: Platform, phase: Phase, message: string) {
    Object.assign(this.state.channels[platform], { phase, message });
    if (!this.state.winner) {
      const channels = this.state.runPlatforms.map((p) => this.state.channels[p]).filter((c) => !c.mergedInto);
      if (channels.length === 1) { this.state.phase = phase; this.state.message = message; }
      else if (channels.every((c) => ["awaiting_user", "error", "stopped"].includes(c.phase))) {
        this.state.phase = "awaiting_user"; this.state.message = "可用渠道均在等待操作，请在下方选择对应渠道接手。";
      } else if (channels.every((c) => ["cooldown", "awaiting_user", "error", "stopped"].includes(c.phase))) {
        this.state.phase = "cooldown"; this.state.message = "可用渠道正在冷却或等待检查，冷却期间停止自动访问。";
      } else {
        this.state.phase = channels.every((c) => c.phase === "scheduled") ? "scheduled" : "monitoring";
        this.state.message = "各渠道独立检查购买入口；首个可购买渠道进入结账后，其余停止。";
      }
    }
    this.publish();
  }
  private async pauseChannel(platform: Platform, message: string, signal: AbortSignal) {
    await this.cooldown(platform, signal);
    this.state.channels[platform].nextCheckAt = null;
    this.state.channels[platform].nextRefreshAt = null;
    message = this.access.issue(platform) ?? message;
    this.channelPhase(platform, "awaiting_user", message); this.log("warn", message, platform);
    await this.wait(signal, (action) => { action ? this.channelResumes.set(platform, action) : this.channelResumes.delete(platform); });
  }
  private async cooldown(platform: Platform, signal: AbortSignal, winner = false) {
    if (!this.access.remaining(platform)) return;
    const message = this.access.issue(platform)!;
    this.state.channels[platform].nextCheckAt = this.access.restriction(platform)!.until;
    this.state.channels[platform].nextRefreshAt = null;
    if (winner) this.phase("cooldown", message); else this.channelPhase(platform, "cooldown", message);
    this.log("warn", message, platform);
    while (this.access.remaining(platform) > 0) await delay(Math.min(this.access.remaining(platform), 60_000), undefined, { signal });
  }
  private async wait(signal: AbortSignal, setAction: (action: (() => void) | null) => void) {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { signal.removeEventListener("abort", aborted); setAction(null); };
      const aborted = () => { cleanup(); reject(signal.reason); };
      setAction(() => { cleanup(); resolve(); }); signal.addEventListener("abort", aborted, { once: true });
    });
    signal.throwIfAborted();
  }
  private async waitForUser(message: string, signal: AbortSignal, phase: Phase = "awaiting_user") {
    if (this.state.winner) {
      await this.cooldown(this.state.winner, signal, true);
      this.state.channels[this.state.winner].nextCheckAt = null;
      message = this.access.issue(this.state.winner) ?? message;
    }
    this.phase(phase, message); this.log("warn", message, this.state.winner ?? undefined);
    await this.wait(signal, (action) => { this.resumeAction = action; });
  }

  private async executeCampaign(plans: Settings[], immediate: boolean, parent: AbortSignal) {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const tasks = plans.map((settings) => {
      const controller = new AbortController(); this.candidates.set(settings.platform, controller);
      const signal = AbortSignal.any([parent, controller.signal]);
      const launch = immediate ? Date.now() : Math.max(Date.parse(settings.launchAt), Date.now());
      timers.push(setTimeout(() => controller.abort(new DOMException("运行时间已到", "TimeoutError")), Math.max(0, launch - Date.now()) + settings.maxMinutes * 60_000));
      return this.monitor(settings, launch, signal).catch((error) => {
        if (!signal.aborted || signal.reason?.name === "TimeoutError") {
          const message = error instanceof NeedsUser ? error.message : signal.reason?.name === "TimeoutError" ? "已达到此渠道最长运行时间。" : "此渠道无法继续，请检查页面后重新启动。";
          this.channelPhase(settings.platform, "error", message); this.log("warn", message, settings.platform);
        }
        throw error;
      });
    });
    try {
      let winner: Candidate;
      try { winner = await Promise.any(tasks); }
      catch { parent.throwIfAborted(); throw new NeedsUser("所有参与渠道均已停止或超时，请检查各渠道提示后重试。"); }
      parent.throwIfAborted(); winner.signal.throwIfAborted(); this.state.winner = winner.settings.platform;
      this.state.winnerProductUrl = winner.settings.productUrl;
      for (const [platform, controller] of this.candidates) if (platform !== this.state.winner) controller.abort();
      await Promise.allSettled(tasks);
      for (const settings of plans) if (settings.platform !== this.state.winner) this.channelPhase(settings.platform, "stopped", "其他渠道已进入结账，此渠道不再执行购买。");
      this.log("success", "已取得唯一购买资格，其他渠道停止。", this.state.winner);
      await this.purchase(winner);
    } finally {
      for (const controller of this.candidates.values()) controller.abort();
      timers.forEach(clearTimeout); await Promise.allSettled(tasks);
    }
  }

  private async monitor(settings: Settings, launch: number, signal: AbortSignal): Promise<Candidate> {
    const platform = settings.platform; const browser = this.getBrowser(platform); const channel = this.state.channels[platform];
    let failures = 0; let skipRefresh = false; let index = 0; let current = settings;
    let opened = false; let bagReady = browser.flow !== "cart";
    const urls = [...new Set([settings.productUrl, settings.backupProductUrl].filter(Boolean))];
    for (;;) {
      signal.throwIfAborted(); channel.attempt++; this.state.attempt++; this.state.lastCheckAt = new Date().toISOString(); channel.nextCheckAt = null;
      this.channelPhase(platform, Date.now() < launch ? "scheduled" : "monitoring", "正在读取当前页面的购买状态。");
      let interval = settings.pollSeconds * 1000;
      try {
        this.access.assertAllowed(platform);
        if (!bagReady) { await browser.assertBagEmpty(signal); bagReady = true; }
        if (!opened) {
          await browser.open(current.productUrl, { signal, refresh: failures > 0 }); opened = true;
        } else if (!skipRefresh && Date.now() - browser.lastNavigationAt >= refreshInterval(settings, launch, Date.now())) {
          index = (index + 1) % urls.length; current = { ...settings, productUrl: urls[index] };
          await browser.open(current.productUrl, { refresh: true, signal });
          this.log("info", `按刷新计划重新读取${urls.length > 1 ? "主备商品" : "商品页面"}。`, platform);
        }
        skipRefresh = false;
        channel.lastRefreshAt = browser.lastNavigationAt ? new Date(browser.lastNavigationAt).toISOString() : null;
        const issue = await browser.intervention();
        if (issue) throw new NeedsUser(issue);
        this.channelPhase(platform, "configuring", "正在选择目标颜色与容量。");
        const configured = await browser.configure(current, signal); const button = configured ? await browser.addButton(current) : null;
        if (Date.now() >= launch && button && await button.isEnabled()) return { settings: current, browser, button, signal };
        failures = 0;
        if (channel.attempt === 1) this.log("info", "已准备商品页面与规格；后续优先读取当前页面，按计划刷新。", platform);
      } catch (error) {
        signal.throwIfAborted();
        const hold = this.access.issue(platform);
        if (error instanceof NeedsUser || hold) { await this.pauseChannel(platform, hold ?? (error as Error).message, signal); skipRefresh = true; continue; }
        failures++;
        if (failures >= 3) { await this.pauseChannel(platform, "连续 3 次无法读取页面，请检查浏览器和网络后继续。", signal); failures = 0; skipRefresh = true; continue; }
        interval = networkBackoff(failures);
        this.log("warn", `页面响应异常，等待 ${interval / 1000} 秒后重试。`, platform);
      }
      const now = Date.now();
      const refreshAt = browser.lastNavigationAt + refreshInterval(settings, launch, now);
      if (failures === 0) interval = Math.min(interval, Math.max(1000, refreshAt - now));
      if (now < launch && failures === 0) interval = Math.min(interval, launch - now);
      channel.nextCheckAt = new Date(now + interval).toISOString();
      channel.nextRefreshAt = new Date(Math.max(now, refreshAt)).toISOString();
      this.channelPhase(platform, now < launch ? "scheduled" : "monitoring", now < launch ? "页面与规格已预加载，等待开售时间。" : "等待页面状态变化；整页刷新按独立计划执行。");
      await delay(interval, undefined, { signal });
    }
  }

  private async purchase({ settings, browser, button, signal }: Candidate) {
    signal.throwIfAborted(); this.phase(browser.flow === "cart" ? "bag" : "checkout", browser.flow === "cart" ? "准备加入购物袋并核对订单。" : "正在进入所选渠道结账页。");
    try { await browser.click(button, signal); }
    catch { signal.throwIfAborted(); await this.waitForUser("购买入口请求结果不明确。请在该平台核对购物车或订单页面；不会再次自动点击购买入口。", signal); }
    for (;;) {
      const issue = await browser.intervention();
      if (!issue) break;
      await this.waitForUser(issue, signal);
    }
    signal.throwIfAborted(); await browser.openBag();
    if (browser.flow === "cart") for (;;) {
      signal.throwIfAborted(); const error = await browser.intervention() ?? validateOrder(await browser.readOrder(settings), settings);
      if (error) { await this.waitForUser(error, signal); continue; }
      if (await browser.isCheckout()) break;
      const checkout = await browser.checkoutButton(settings);
      if (!checkout || await checkout.isDisabled()) { await this.waitForUser("未识别唯一结账按钮，请在平台打开结账页面后继续。", signal); continue; }
      await browser.click(checkout, signal); this.log("success", "购物袋核对通过，已进入结账。", settings.platform); break;
    }
    let steps = 0;
    for (;;) {
      signal.throwIfAborted(); if (await browser.isConfirmed()) { await this.complete(settings); return; }
      this.phase("checkout", "正在使用平台已有的收货与付款信息推进结账。");
      const issue = await browser.intervention(); if (issue) { await this.waitForUser(issue, signal); continue; }
      const submit = await browser.submitButton(settings);
      if (submit) {
        const error = validateOrder(await browser.readOrder(settings), settings); if (error) { await this.waitForUser(error, signal); continue; }
        if (!settings.autoSubmit) {
          await this.recordAttempt(settings);
          await this.waitForUser("配置与总价核对通过。请在此平台确认并提交订单，完成后点击“已操作，继续”。其他渠道已停止。", signal, "ready"); continue;
        }
        if (await submit.isDisabled() || await browser.hasEmptyRequiredFields()) { await this.waitForUser("提交按钮不可用或有必填信息，请在平台补全收货信息并确认条款。", signal); continue; }
        await this.submitOnce(settings, browser, submit, signal); return;
      }
      if (await browser.hasEmptyRequiredFields()) { await this.waitForUser("结账页面有必填信息，请在平台填写后继续。", signal); continue; }
      const next = await browser.nextCheckoutButton();
      if (!next || await next.isDisabled() || steps >= 10) { await this.waitForUser("请在浏览器打开并确认当前结账步骤；完成后点击“已操作，继续”。其他渠道保持停止。", signal); steps = 0; continue; }
      await browser.click(next, signal); steps++; this.log("info", "已推进一个结账步骤。", settings.platform);
    }
  }

  private async recordAttempt(settings: Settings) {
    if (this.state.submission && !this.state.submission.resolved) {
      if (this.state.submission.runId === this.state.runId && this.state.submission.platform === settings.platform) return;
      throw new NeedsUser("已有其他提交或人工交接记录，请先核对平台订单。");
    }
    const record: Submission = { platform: settings.platform, productUrl: settings.productUrl, runId: this.state.runId!, at: new Date().toISOString(), fingerprint: fingerprint(settings), result: "unknown" };
    await writeJson("submission.json", record); this.state.submission = record; this.publish();
  }
  private async submitOnce(settings: Settings, browser: AppleBrowser, submit: Parameters<AppleBrowser["click"]>[0], signal: AbortSignal) {
    signal.throwIfAborted(); if (this.state.submission && !this.state.submission.resolved) throw new NeedsUser("已存在一次提交尝试，请先核对平台订单。");
    await this.recordAttempt(settings); this.phase("submitting", "订单核对通过，正在进行所有渠道共用的唯一提交尝试。");
    const lastIssue = await browser.intervention() ?? validateOrder(await browser.readOrder(settings), settings);
    if (lastIssue) throw new NeedsUser(`提交前页面状态发生变化：${lastIssue}。已保留提交锁，请在平台核对后处理。`);
    this.log("warn", "提交记录已持久化；所有渠道均不会自动重复提交。", settings.platform);
    try { await browser.click(submit, signal); } catch { signal.throwIfAborted(); }
    for (;;) {
      signal.throwIfAborted(); if (await browser.isConfirmed()) { await this.complete(settings); return; }
      await this.waitForUser("已尝试提交订单，尚未确认结果。请在对应平台核对订单或完成付款；所有渠道均不会自动重试。", signal);
    }
  }
  private async complete(settings: Settings) {
    await this.recordAttempt(settings); const record: Submission = { ...this.state.submission!, result: "confirmed" };
    await writeJson("submission.json", record); this.state.submission = record;
    this.phase("completed", `${PLATFORM_INFO[settings.platform].name}已显示订单确认页和订单号。请在平台查看付款与配送状态。`);
    this.log("success", "已识别订单确认页；付款状态以平台为准。其他渠道已停止。", settings.platform);
  }
}
