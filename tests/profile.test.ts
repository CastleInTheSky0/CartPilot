import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { BrowserContext } from "playwright";

// Exercise the production visible Chrome/profile path when Chrome is installed.
// Product traffic is intercepted, and each browser is blanked before closing so
// reopening the fixture profile cannot restore a real store tab.
const hasChrome = process.platform === 'win32' && [
  path.join(process.env.PROGRAMFILES ?? '', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env['PROGRAMFILES(X86)'] ?? '', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
].some(existsSync);

process.env.DUO_DATA_DIR = path.resolve('output', 'tests', randomUUID());
process.env.DUO_BROWSER_CHANNEL = 'chrome';
const { createBrowser } = await import('../server/marketplace.ts');
const { AccessGuard } = await import('../server/access.ts');
const { defaultPlan } = await import('../shared/types.ts');

test('production Chrome preserves its dedicated login profile and reuses the current listing', { skip: !hasChrome }, async () => {
  const settings = { ...defaultPlan('jd'), productUrl: 'https://item.jd.com/123456789.html' };
  let requests = 0;
  const intercept = (context: BrowserContext) => context.route('**/*', async (route) => {
    if (route.request().url().startsWith(settings.productUrl)) {
      requests++;
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<main>Offline profile fixture</main>' });
    } else await route.abort();
  });
  const first = createBrowser('jd', () => {});
  first.access = new AccessGuard({ globalGapMs: 0, familyGapMs: 0 });
  try {
    const page = await first.getPage(); await intercept(first.context!);
    await first.open(settings.productUrl);
    await page.evaluate(() => { localStorage.setItem('fixture-session', 'persisted'); });
    await first.context!.addCookies([{ name: 'fixture-session', value: 'persisted', domain: 'item.jd.com', path: '/', secure: true, expires: Math.floor(Date.now() / 1000) + 3600 }]);
    await page.goto('about:blank');
  } finally { await first.close(); }
  const second = createBrowser('jd', () => {});
  second.access = new AccessGuard({ globalGapMs: 0, familyGapMs: 0 });
  try {
    const page = await second.getPage(); await intercept(second.context!);
    await second.open(settings.productUrl);
    assert.equal(await page.evaluate(() => localStorage.getItem('fixture-session')), 'persisted');
    assert.equal((await second.context!.cookies(settings.productUrl)).find((cookie) => cookie.name === 'fixture-session')?.value, 'persisted');
    await second.open(settings.productUrl + '?source=tracking');
    await second.probe(settings);
    assert.equal(requests, 2, 'each browser session makes one product navigation, repeated reads reuse it');
    await page.goto('about:blank');
  } finally { await second.close(); }
});
