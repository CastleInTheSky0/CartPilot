import test from "node:test";
import assert from "node:assert/strict";
import { AccessGuard, retryAfterMs, validateAccessState, type AccessState } from "../server/access.ts";
import { deduplicatePlans, networkBackoff, refreshInterval } from "../server/monitoring.ts";
import { DEFAULT_SETTINGS, defaultPlan } from "../shared/types.ts";
import { validateSettings } from "../server/safety.ts";

test('Retry-After supports seconds and HTTP dates with server clock skew', () => {
  const now = Date.parse('2026-10-15T00:00:00Z');
  assert.equal(retryAfterMs('90', now), 90_000);
  assert.equal(retryAfterMs('Thu, 15 Oct 2026 00:01:00 GMT', now), 60_000);
  assert.equal(retryAfterMs('Thu, 15 Oct 2026 01:01:00 GMT', now, 'Thu, 15 Oct 2026 01:00:00 GMT'), 60_000);
  assert.equal(retryAfterMs('Thu, 15 Oct 2026 00:00:00 GMT', now + 10_000), 0);
  for (const value of [undefined, '', 'tomorrow', '-1', '1.5', '999999999999999999999999']) assert.equal(retryAfterMs(value, now), null);
});

test('a persisted shared-marketplace restriction survives expiry until explicit review', async () => {
  let now = 1_000_000;
  let saved: AccessState | undefined;
  const guard = new AccessGuard({ now: () => now, persist: async (state) => { saved = state; } });
  guard.blockHttp('tmall', 429, '60'); await guard.flush();
  assert.equal(guard.remaining('taobao'), 60_000);
  assert.equal(guard.issue('jd'), null);
  assert.throws(() => guard.acknowledge('taobao'), /冷却/);
  const restarted = new AccessGuard({ state: saved, now: () => now });
  assert.throws(() => restarted.assertAllowed('tmall'), /429/);
  now += 61_000;
  assert.equal(restarted.remaining('tmall'), 0);
  assert.throws(() => restarted.assertAllowed('taobao'), /手动继续/);
  restarted.acknowledge('taobao');
  assert.equal(restarted.issue('tmall'), null);
});

test('restriction defaults are conservative and later responses never shorten a cooldown', () => {
  let now = 1_000_000;
  const guard = new AccessGuard({ now: () => now });
  guard.blockHttp('jd', 429);
  assert.equal(guard.remaining('jd'), 300_000);
  guard.blockHttp('jd', 403, '1');
  assert.equal(guard.remaining('jd'), 600_000);
  now += 10_000; guard.blockHttp('jd', 429, '1');
  assert.equal(guard.remaining('jd'), 590_000);
  guard.blockHttp('apple', 541, '900');
  assert.equal(guard.remaining('apple'), 900_000);
});

test('navigation applies both the global gap and shared Taobao/Tmall gap', async () => {
  let now = 10_000;
  const guard = new AccessGuard({ now: () => now, wait: async (ms) => { now += ms; } });
  const starts: number[] = [];
  for (const platform of ['tmall', 'taobao', 'jd', 'jd'] as const) await guard.navigate(platform, async () => { starts.push(now); });
  assert.deepEqual(starts, [10_000, 15_000, 16_500, 21_500]);
});

test('a queued navigation rechecks a restriction before starting', async () => {
  const guard = new AccessGuard({ globalGapMs: 0, familyGapMs: 0 });
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  let requests = 0;
  const first = guard.navigate('jd', async () => { requests++; started(); await new Promise<void>((resolve) => { release = resolve; }); });
  await ready;
  const second = guard.navigate('jd', async () => { requests++; });
  const rejected = assert.rejects(second, /429/);
  guard.blockHttp('jd', 429, '120'); release();
  await first; await rejected;
  assert.equal(requests, 1);
});

test('cancelled navigation and failed persistence prevent further automatic requests', async () => {
  let requests = 0;
  const guard = new AccessGuard({ persist: async () => { throw new Error('disk full'); } });
  guard.blockHttp('jd', 429, '1');
  await assert.rejects(() => guard.navigate('apple', async () => { requests++; }), /保存失败/);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(() => new AccessGuard().navigate('jd', async () => { requests++; }, aborted.signal), { name: 'AbortError' });
  assert.equal(requests, 0);
  assert.throws(() => validateAccessState({ version: 1, restrictions: { jd: { until: 'invalid', message: '', status: 429 } } }));
});

test('identical Taobao/Tmall listings share one Tmall worker and retain independent listings', () => {
  const taobao = { ...defaultPlan('taobao'), productUrl: 'https://detail.tmall.com/item.htm?id=123456789&source=taobao' };
  const tmall = { ...defaultPlan('tmall'), productUrl: 'https://detail.tmall.com/item.htm?id=123456789' };
  const jd = { ...defaultPlan('jd'), productUrl: 'https://item.jd.com/123456789.html' };
  const result = deduplicatePlans([taobao, tmall, jd]);
  assert.equal(result.plans.length, 2);
  assert.equal(result.merged.taobao, 'tmall');
  assert.equal(result.plans.find((plan) => plan.platform === 'tmall')!.productUrl, tmall.productUrl);
  assert.equal(taobao.productUrl.includes('source='), true);
  assert.throws(() => deduplicatePlans([taobao, { ...tmall, maxTotal: 1 }]), /不同购买配置/);
  assert.throws(() => deduplicatePlans([taobao, { ...tmall, autoSubmit: true }]), /不同购买配置/);
});

test('backups already monitored by another worker are removed without dropping unique backups', () => {
  const taobao = { ...defaultPlan('taobao'), productUrl: 'https://detail.tmall.com/item.htm?id=111', backupProductUrl: 'https://detail.tmall.com/item.htm?id=222' };
  const tmall = { ...defaultPlan('tmall'), productUrl: 'https://detail.tmall.com/item.htm?id=222', backupProductUrl: 'https://detail.tmall.com/item.htm?id=333' };
  const result = deduplicatePlans([taobao, tmall]);
  assert.equal(result.plans.find((plan) => plan.platform === 'taobao')!.backupProductUrl, '');
  assert.equal(result.plans.find((plan) => plan.platform === 'tmall')!.backupProductUrl, tmall.backupProductUrl);
});

test('legacy settings receive independent reload intervals and retries back off to five minutes', () => {
  const legacy = structuredClone(DEFAULT_SETTINGS) as Partial<typeof DEFAULT_SETTINGS>;
  delete legacy.refreshSeconds; delete legacy.launchRefreshSeconds;
  const settings = validateSettings(legacy);
  assert.equal(settings.refreshSeconds, 120);
  assert.equal(settings.launchRefreshSeconds, 30);
  assert.equal(refreshInterval(settings, 1_000_000, 879_999), 120_000);
  assert.equal(refreshInterval(settings, 1_000_000, 880_000), 30_000);
  assert.equal(refreshInterval(settings, 1_000_000, 1_120_001), 120_000);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(networkBackoff), [30_000, 60_000, 120_000, 240_000, 300_000, 300_000]);
  assert.throws(() => validateSettings({ ...settings, refreshSeconds: 10 }), /日常页面刷新/);
  assert.throws(() => validateSettings({ ...settings, launchRefreshSeconds: 1 }), /开售窗口/);
});
