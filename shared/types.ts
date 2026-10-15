export const COLORS = ["星光白色", "夜空色"] as const;
export const CAPACITIES = ["256GB", "512GB", "1TB", "2TB"] as const;
export const REFERENCE_PRICES = {
  "256GB": 15999,
  "512GB": 17999,
  "1TB": 21499,
  "2TB": 26499,
} as const;
export const PRODUCT_URL =
  "https://www.apple.com.cn/shop/buy-iphone/iphone-duo";
export const OFFICIAL_LAUNCH = "2026-10-16T20:00:00+08:00";

export const PLATFORMS = ["apple", "taobao", "tmall", "jd", "douyin"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const PLATFORM_INFO = {
  apple: {
    name: "Apple 中国官网", shortName: "Apple 官网", host: "www.apple.com.cn",
    loginUrl: "https://www.apple.com.cn/shop/account/home",
    searchUrl: PRODUCT_URL, hint: "https://www.apple.com.cn/shop/buy-iphone/iphone-duo",
    note: "选择配置后加入购物袋，再推进结账。",
  },
  taobao: {
    name: "淘宝", shortName: "淘宝", host: "item.taobao.com",
    loginUrl: "https://login.taobao.com/member/login.jhtml",
    searchUrl: "https://s.taobao.com/search?q=iPhone%20Duo",
    hint: "完整淘宝或天猫商品详情链接，需含商品编号",
    note: "淘宝可配置淘宝或天猫商品链接，登录与验证在浏览器完成。",
  },
  tmall: {
    name: "天猫", shortName: "天猫", host: "detail.tmall.com",
    loginUrl: "https://login.tmall.com/",
    searchUrl: "https://list.tmall.com/search_product.htm?q=iPhone%20Duo",
    hint: "https://detail.tmall.com/item.htm?id=商品编号",
    note: "使用商品详情页的立即购买入口；定金与分期订单需要人工处理。",
  },
  jd: {
    name: "京东", shortName: "京东", host: "item.jd.com",
    loginUrl: "https://passport.jd.com/new/login.aspx",
    searchUrl: "https://search.jd.com/Search?keyword=iPhone%20Duo&enc=utf-8",
    hint: "https://item.jd.com/商品编号.html",
    note: "使用立即购买或立即抢购入口；遇到访问限制会暂停。",
  },
  douyin: {
    name: "抖音商城", shortName: "抖音商城", host: "douyin.com / jinritemai.com",
    loginUrl: "https://www.douyin.com/",
    searchUrl: "https://www.douyin.com/search/iPhone%20Duo",
    hint: "粘贴完整商品详情链接，短链接请先在浏览器展开",
    note: "仅处理可在网页购买的商品；扫码、唤起 App 与支付需要接手。",
  },
} as const;
export type RunMode = "single" | "race";
export type BrowserMode = "extension" | "managed";
export const EXTENSION_INSTALL_URL = "https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm";
export type BrowserConnectionConfig = { version: 1; mode: BrowserMode; profileDirectory: string | null };
export type ExtensionConnectionState = {
  phase: "disconnected" | "connecting" | "connected" | "error";
  message: string;
  connectedAt: string | null;
};
export type BrowserTab = { id: string; title: string; url: string };

export type Selectors = {
  color: string;
  capacity: string;
  addToBag: string;
  checkout: string;
  submit: string;
  total: string;
  lineItems: string;
  quantity: string;
  seller: string;
  productTitle: string;
};

export type Settings = {
  platform: Platform;
  productUrl: string;
  backupProductUrl: string;
  expectedSeller: string;
  color: (typeof COLORS)[number];
  capacity: (typeof CAPACITIES)[number];
  launchAt: string;
  quantity: 1;
  maxTotal: number;
  autoSubmit: boolean;
  pollSeconds: number;
  refreshSeconds: number;
  launchRefreshSeconds: number;
  maxMinutes: number;
  notifications: boolean;
  selectors: Selectors;
};

export const DEFAULT_SETTINGS: Settings = {
  platform: "apple",
  productUrl: PRODUCT_URL,
  backupProductUrl: "",
  expectedSeller: "",
  color: "星光白色",
  capacity: "256GB",
  launchAt: OFFICIAL_LAUNCH,
  quantity: 1,
  maxTotal: 15999,
  autoSubmit: false,
  pollSeconds: 10,
  refreshSeconds: 120,
  launchRefreshSeconds: 30,
  maxMinutes: 20,
  notifications: true,
  selectors: {
    color: "",
    capacity: "",
    addToBag: "",
    checkout: "",
    submit: "",
    total: "",
    lineItems: "",
    quantity: "",
    seller: "",
    productTitle: "",
  },
};

export function defaultPlan(platform: Platform): Settings {
  return { ...structuredClone(DEFAULT_SETTINGS), platform, productUrl: platform === "apple" ? PRODUCT_URL : "" };
}
export type Workspace = {
  version: 2;
  activePlatform: Platform;
  mode: RunMode;
  enabledPlatforms: Platform[];
  plans: Record<Platform, Settings>;
};
export function defaultWorkspace(settings: Settings = structuredClone(DEFAULT_SETTINGS)): Workspace {
  const plans = Object.fromEntries(PLATFORMS.map((platform) => [platform, defaultPlan(platform)])) as Workspace["plans"];
  plans[settings.platform] = structuredClone(settings);
  return { version: 2, activePlatform: settings.platform, mode: "single", enabledPlatforms: [settings.platform], plans };
}

export type Phase =
  | "idle"
  | "scheduled"
  | "monitoring"
  | "cooldown"
  | "merged"
  | "configuring"
  | "bag"
  | "checkout"
  | "awaiting_user"
  | "ready"
  | "submitting"
  | "completed"
  | "stopped"
  | "error";
export type Level = "info" | "success" | "warn" | "error";
export type LogEntry = {
  id: string;
  at: string;
  level: Level;
  message: string;
};
export type Probe = {
  platform: Platform;
  at: string;
  title: string;
  url: string;
  selectable: boolean;
  note: string;
};
export type Submission = {
  platform?: Platform;
  productUrl?: string;
  runId: string;
  at: string;
  fingerprint: string;
  result: "unknown" | "confirmed";
  resolved?: boolean;
};

export type AppState = {
  workspace: Workspace;
  channels: Record<Platform, ChannelState>;
  runPlatforms: Platform[];
  winner: Platform | null;
  winnerProductUrl: string | null;
  settings: Settings;
  phase: Phase;
  message: string;
  runId: string | null;
  attempt: number;
  startedAt: string | null;
  nextCheckAt: string | null;
  lastCheckAt: string | null;
  browserOpen: boolean;
  browserBusy: boolean;
  browserName: string;
  browserConnection: BrowserConnectionConfig & { extension: ExtensionConnectionState };
  serverNow: string;
  logs: LogEntry[];
  probe: Probe | null;
  submission: Submission | null;
};

export type LoginStatus = {
  state: "logged_in" | "logged_out" | "unknown";
  reason: "authenticated" | "login_required" | "verification" | "unrecognized" | "unavailable" | "browser_closed" | "page_changed" | "stale";
  message: string;
  checkedAt: string | null;
};
export const LOGIN_STATUS_TTL = 45_000;

export type ChannelState = {
  phase: Phase;
  message: string;
  attempt: number;
  browserOpen: boolean;
  login: LoginStatus;
  extensionTab: BrowserTab | null;
  nextCheckAt: string | null;
  probe: Probe | null;
  cooldownUntil: string | null;
  restriction: string | null;
  lastRefreshAt: string | null;
  nextRefreshAt: string | null;
  mergedInto: Platform | null;
};

export const PHASE_LABELS: Record<Phase, string> = {
  idle: "等待启动",
  scheduled: "等待开售",
  monitoring: "检查购买入口",
  cooldown: "访问冷却中",
  merged: "已合并监控",
  configuring: "选择配置",
  bag: "核对购物袋",
  checkout: "进行结账",
  awaiting_user: "需要你接手",
  ready: "等待确认下单",
  submitting: "正在提交订单",
  completed: "已识别订单确认",
  stopped: "已停止",
  error: "执行异常",
};

export const ACTIVE_PHASES: Phase[] = [
  "scheduled",
  "monitoring",
  "cooldown",
  "configuring",
  "bag",
  "checkout",
  "awaiting_user",
  "ready",
  "submitting",
];
