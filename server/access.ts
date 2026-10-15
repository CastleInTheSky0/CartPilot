import { setTimeout as delay } from "node:timers/promises";
import { PLATFORM_INFO, type Platform } from "../shared/types.ts";

export class NeedsUser extends Error {}
export type AccessFamily = Exclude<Platform, "tmall">;
export const accessFamily = (platform: Platform): AccessFamily => platform === "tmall" ? "taobao" : platform;
export type Restriction = { until: string; message: string; status: number };
export type AccessState = { version: 1; restrictions: Partial<Record<AccessFamily, Restriction>> };

export function validateAccessState(input: unknown): AccessState {
  const state = input as AccessState;
  if (!state || state.version !== 1 || !state.restrictions || typeof state.restrictions !== "object" || Array.isArray(state.restrictions))
    throw new Error("访问限制记录格式不正确。");
  for (const [family, item] of Object.entries(state.restrictions)) {
    if (!["apple", "taobao", "jd", "douyin"].includes(family) || !item ||
      typeof item.until !== "string" || !Number.isFinite(Date.parse(item.until)) ||
      typeof item.message !== "string" || ![403, 429, 541].includes(item.status))
      throw new Error("访问限制记录格式不正确。");
  }
  return structuredClone(state);
}

// Retry-After is either an integer number of seconds or an HTTP date.
// Relative dates use the server's Date header when available to tolerate clock skew.
export function retryAfterMs(value: string | undefined, now: number, serverDate?: string): number | null {
  if (!value?.trim()) return null;
  const text = value.trim();
  if (/^\d+$/.test(text)) {
    const ms = Number(text) * 1000;
    return Number.isSafeInteger(ms) && now + ms <= 8.64e15 ? ms : null;
  }
  if (!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),/i.test(text)) return null;
  const date = Date.parse(text);
  const reference = serverDate ? Date.parse(serverDate) : now;
  return Number.isFinite(date) ? Math.max(0, date - (Number.isFinite(reference) ? reference : now)) : null;
}

type Options = {
  state?: AccessState;
  persist?: (state: AccessState) => Promise<void>;
  now?: () => number;
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
  globalGapMs?: number;
  familyGapMs?: number;
};

export class AccessGuard {
  private records: AccessState;
  private now: () => number;
  private sleep: NonNullable<Options["wait"]>;
  private globalGap: number;
  private familyGap: number;
  private globalNext = 0;
  private familyNext = new Map<AccessFamily, number>();
  private familyTails = new Map<AccessFamily, Promise<void>>();
  private slotTail = Promise.resolve();
  private persistTail = Promise.resolve();
  private persistenceFailed = false;
  private listeners = new Set<() => void>();

  constructor(private options: Options = {}) {
    this.records = options.state ? validateAccessState(options.state) : { version: 1, restrictions: {} };
    this.now = options.now ?? Date.now;
    this.sleep = options.wait ?? (async (ms, signal) => { await delay(ms, undefined, { signal }); });
    this.globalGap = options.globalGapMs ?? 1500;
    this.familyGap = options.familyGapMs ?? 5000;
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  snapshot(): AccessState { return structuredClone(this.records); }
  restriction(platform: Platform) { return this.records.restrictions[accessFamily(platform)] ?? null; }
  remaining(platform: Platform) { return Math.max(0, Date.parse(this.restriction(platform)?.until ?? "") - this.now()) || 0; }
  issue(platform: Platform) {
    const record = this.restriction(platform);
    if (this.persistenceFailed) return "访问限制记录保存失败，请检查磁盘后重新启动助手。";
    if (!record) return null;
    return this.remaining(platform) > 0
      ? `${record.message} 请等待冷却结束，再检查页面并手动继续。`
      : `${record.message} 冷却已结束，请在执行浏览器检查页面，完成验证后手动继续。`;
  }
  assertAllowed(platform: Platform) {
    const issue = this.issue(platform);
    if (issue) throw new NeedsUser(issue);
  }
  blockHttp(platform: Platform, status: number, retryAfter?: string, serverDate?: string) {
    if (![403, 429, 541].includes(status)) return;
    const now = this.now();
    const advised = retryAfterMs(retryAfter, now, serverDate);
    const cooldown = status === 429 ? Math.max(1000, advised ?? 300_000) : Math.max(600_000, advised ?? 0);
    const prior = this.restriction(platform);
    const until = Math.max(prior ? Date.parse(prior.until) : 0, now + cooldown);
    this.records.restrictions[accessFamily(platform)] = {
      until: new Date(until).toISOString(), status,
      message: `${PLATFORM_INFO[platform].name}限制了访问（${status}）。`,
    };
    this.changed();
  }
  acknowledge(platform: Platform) {
    if (this.remaining(platform) > 0) throw new NeedsUser("此渠道仍在冷却，请等待冷却结束后再继续。");
    if (this.restriction(platform)) {
      delete this.records.restrictions[accessFamily(platform)];
      this.changed();
    }
  }
  private changed() {
    const snapshot = this.snapshot();
    this.persistTail = this.persistTail.then(async () => {
      try { await this.options.persist?.(snapshot); this.persistenceFailed = false; }
      catch { this.persistenceFailed = true; }
    });
    for (const listener of this.listeners) listener();
  }
  async flush() {
    await this.persistTail;
    if (this.persistenceFailed) throw new NeedsUser("访问限制记录保存失败，请检查磁盘后重新启动助手。");
  }
  async navigate<T>(platform: Platform, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const family = accessFamily(platform);
    const previous = this.familyTails.get(family) ?? Promise.resolve();
    const result = previous.then(async () => {
      signal?.throwIfAborted(); await this.flush(); this.assertAllowed(platform);
      const slot = this.slotTail.then(async () => {
        const wait = Math.max(this.globalNext, this.familyNext.get(family) ?? 0) - this.now();
        if (wait > 0) await this.sleep(wait, signal);
        signal?.throwIfAborted(); this.assertAllowed(platform);
        this.globalNext = this.now() + this.globalGap;
        this.familyNext.set(family, this.now() + this.familyGap);
      });
      this.slotTail = slot.catch(() => {});
      await slot; signal?.throwIfAborted(); this.assertAllowed(platform);
      return work();
    });
    this.familyTails.set(family, result.then(() => {}, () => {}));
    return result;
  }
}
