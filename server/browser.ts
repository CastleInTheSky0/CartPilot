import {
  chromium,
  type BrowserContext,
  type Page,
  type Locator,
} from "playwright";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { DATA_DIR } from "./store.ts";
import {
  isAppleUrl,
  parseCny,
  publicUrl,
  isPlatformUrl,
  productId,
  type OrderEvidence,
} from "./safety.ts";
import { PLATFORM_INFO, type BrowserMode, type Settings, type Probe, type Platform } from "../shared/types.ts";
import { AccessGuard, NeedsUser } from "./access.ts";
import { readLoginStatus } from "./login.ts";
export { NeedsUser } from "./access.ts";

export function browserRuntime() {
  const channel = process.env.DUO_BROWSER_CHANNEL ?? "chrome";
  if (!["chrome", "chromium"].includes(channel)) throw new Error("DUO_BROWSER_CHANNEL 仅支持 chrome 或 chromium。");
  return { channel, name: channel === "chrome" ? "Google Chrome · 固定会话" : "Chromium · 固定会话" };
}
const BAG_URL = "https://www.apple.com.cn/shop/bag";
const ITEM_SELECTOR =
  '[data-autom="bag-item"], .rs-bag-product, [data-autom="checkout-cart-item"], [data-autom="review-product"]';
const FINAL_NAME =
  /^(?:下订单|提交订单|立即下单|确认并支付|下单并支付|Place Your Order|Place Order)(?:\s|$)/i;
const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export class AppleBrowser {
  readonly flow: "cart" | "direct" = "cart";
  context: BrowserContext | null = null;
  page: Page | null = null;
  private opening: Promise<Page> | null = null;
  access = new AccessGuard();
  lastNavigationAt = 0;
  private trackedPages = new Map<Page, () => void>();
  private extensionContextListener: ((page: Page) => void) | null = null;
  mode: BrowserMode = "managed";
  onSessionChange: (() => void) | null = null;
  constructor(private onChange: (open: boolean) => void, readonly platform: Platform = "apple") {}

  allowed(url: string) { return isPlatformUrl(url, this.platform); }
  get label() { return PLATFORM_INFO[this.platform].name; }
  get isOpen() { return !!this.page && !this.page.isClosed(); }
  ownsPage(page: Page) { return this.trackedPages.has(page); }
  checkLogin() { return readLoginStatus(this.page, this.platform); }

  private attachPage(page: Page) {
    this.page = page;
    if (this.trackedPages.has(page)) { this.onChange(true); return; }
    if (page.url() !== "about:blank") this.lastNavigationAt = Date.now();
    const navigated = (frame: import("playwright").Frame) => {
      if (frame === page.mainFrame()) {
        this.lastNavigationAt = Date.now();
        if (this.page === page) this.onSessionChange?.();
      }
    };
    const loaded = () => { if (this.page === page) this.onSessionChange?.(); };
    const closed = () => {
      this.trackedPages.get(page)?.();
      this.trackedPages.delete(page);
      if (this.page !== page) return;
      this.page = this.mode === "extension" ? [...this.trackedPages.keys()].filter((candidate) => !candidate.isClosed()).at(-1) ?? null : this.context?.pages().filter((candidate) => !candidate.isClosed()).at(-1) ?? null;
      this.onChange(!!this.page);
      this.onSessionChange?.();
    };
    const responseReceived = (response: import("playwright").Response) => {
      if (this.page === page && [403, 429, 541].includes(response.status()) && this.allowed(response.url()) &&
        ["document", "xhr", "fetch"].includes(response.request().resourceType()) &&
        (this.platform !== "apple" || new URL(response.url()).pathname.startsWith("/shop/")))
        this.access.blockHttp(this.platform, response.status(), response.headers()["retry-after"], response.headers()["date"]);
    };
    page.on("framenavigated", navigated);
    page.on("domcontentloaded", loaded);
    page.on("close", closed);
    page.on("response", responseReceived);
    this.trackedPages.set(page, () => {
      page.off("framenavigated", navigated); page.off("domcontentloaded", loaded);
      page.off("close", closed); page.off("response", responseReceived);
    });
    this.onChange(true);
    this.onSessionChange?.();
  }

  async attachExtensionPage(page: Page) {
    if (this.mode !== "extension") throw new Error("请先切换到普通浏览器扩展模式。");
    if (page.isClosed() || !this.allowed(page.url())) throw new Error(`请选择${this.label}的标签页。`);
    this.releaseExtensionPage();
    this.context = page.context();
    // Scope defaults to this Playwright Page; never alter the shared Chrome profile.
    page.setDefaultTimeout(5000); page.setDefaultNavigationTimeout(25000);
    this.attachPage(page);
    this.extensionContextListener = (candidate) => {
      void candidate.opener().then((opener) => {
        if (this.context !== candidate.context() || !opener || !this.trackedPages.has(opener)) return;
        // A login/checkout popup inherits authorization from the chosen tab.
        if (!candidate.isClosed()) this.attachPage(candidate);
      }).catch(() => {});
    };
    this.context.on("page", this.extensionContextListener);
  }
  private releaseExtensionPage() {
    if (this.extensionContextListener) this.context?.off("page", this.extensionContextListener);
    this.extensionContextListener = null;
    for (const release of this.trackedPages.values()) release();
    this.trackedPages.clear();
    this.context = null; this.page = null;
    this.onChange(false);
    this.onSessionChange?.();
  }

  async getPage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;
    if (this.mode === "extension") throw new NeedsUser(`请先连接普通浏览器扩展，并接入${this.label}的标签页。`);
    if (this.opening) return this.opening;
    this.opening = (async () => {
      if (!this.context) {
        try {
          const runtime = browserRuntime();
          this.context = await chromium.launchPersistentContext(
            runtime.channel === "chrome" ? path.join(DATA_DIR, "chrome-profiles", this.platform) :
              path.join(DATA_DIR, this.platform === "apple" ? "browser-profile" : `browser-profile-${this.platform}`),
            {
              channel: runtime.channel,
              headless: false,
              locale: "zh-CN",
              timezoneId: "Asia/Shanghai",
              viewport: { width: 1360, height: 900 },
            },
          );
        } catch {
          throw new Error(
            "执行浏览器无法启动。请确认已安装 Google Chrome，且此平台的助手窗口未被另一实例占用。需要使用已安装的 Chromium 时，可设置 DUO_BROWSER_CHANNEL=chromium 后重启助手。",
          );
        }
        this.context.setDefaultTimeout(5000);
        this.context.setDefaultNavigationTimeout(25000);
        this.context.on("close", () => {
          this.context = null;
          this.page = null;
          this.onChange(false);
        });
      }
      this.attachPage(this.context.pages()[0] ?? (await this.context.newPage()));
      // Product links and checkout commonly open a new tab in marketplaces.
      this.context.on("page", (page) => this.attachPage(page));
      return this.page!;
    })();
    try {
      return await this.opening;
    } finally {
      this.opening = null;
    }
  }

  async open(url: string, options: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<Page> {
    if (!this.allowed(url))
      throw new NeedsUser(`当前链接不属于${this.label}，请手动处理。`);
    this.access.assertAllowed(this.platform);
    options.signal?.throwIfAborted();
    const page = await this.getPage();
    const expected = productId(url, this.platform);
    const sku = new URL(url).searchParams.get("skuId");
    const sameListing = !!expected && productId(page.url(), this.platform) === expected &&
      (!sku || new URL(page.url()).searchParams.get("skuId") === sku);
    if (options.refresh || (!sameListing && page.url() !== url)) {
      await this.access.navigate(this.platform, async () => {
        options.signal?.throwIfAborted();
        await page.goto(url, { waitUntil: "domcontentloaded" });
      }, options.signal);
    }
    await this.settle(options.signal);
    return page;
  }

  async focus() {
    const page = await this.getPage();
    await page.bringToFront();
  }
  async close() {
    if (this.mode === "extension") { this.releaseExtensionPage(); return; }
    await this.context?.close();
  }
  clearIntervention() {
    this.access.acknowledge(this.platform);
  }
  async settle(signal?: AbortSignal) {
    if (!this.page || this.page.isClosed())
      throw new NeedsUser("浏览器窗口已关闭，请重新打开。");
    await this.page.waitForLoadState("domcontentloaded");
    await delay(450, undefined, { signal });
    signal?.throwIfAborted();
  }

  async mainText() {
    const page = await this.getPage();
    if (!this.allowed(page.url()))
      throw new NeedsUser(
        `已进入${this.platform === "apple" ? " Apple 以外" : this.label + "以外"}的页面，请在浏览器中完成后续操作。`,
      );
    const main = page.locator("main").first();
    return await (
      (await main.count()) ? main : page.locator("body")
    ).innerText();
  }

  async intervention() {
    const hold = this.access.issue(this.platform);
    if (hold) return hold;
    const page = await this.getPage();
    if (!this.allowed(page.url())) return `已进入${this.platform === "apple" ? " Apple 以外" : this.label + "以外"}的页面，请在浏览器中完成付款或其他操作后继续。`;
    const text = await this.mainText();
    const verification = page.locator(
      'iframe[src*="captcha"], iframe[title*="验证码"], iframe[title*="CAPTCHA"]',
    );
    for (let i = 0; i < (await verification.count()); i++)
      if (await verification.nth(i).isVisible())
        return "检测到验证码，请在浏览器中完成验证。";
    const loginFrames = page.locator('iframe[src*="login.taobao.com"], iframe[src*="login.tmall.com"], iframe[src*="passport.jd.com"], iframe[title*="登录"]');
    for (let i = 0; i < await loginFrames.count(); i++) if (await loginFrames.nth(i).isVisible())
      return `请在浏览器中完成${this.label}登录。`;
    if (
      /验证你是人类|验证您是人类|请输入验证码|安全验证|访问被拒绝|拖动.{0,12}滑块|点击.{0,8}验证|访问过于频繁|操作过于频繁|access denied|too many requests/i.test(
        text,
      )
    )
      return `${this.label}要求安全验证或限制了访问，请在浏览器中处理。`;
    if (this.platform !== "apple") {
      const url = new URL(page.url());
      if (/^(?:login|passport)\./.test(url.hostname) || /(?:login|risk_handler|captcha|verify)/i.test(url.pathname) ||
        (await page.locator('input[type="password"]:visible').count()))
        return `请在浏览器中完成${this.label}登录或安全验证。`;
      if (/请(?:打开|前往).{0,8}(?:APP|客户端)|打开抖音.{0,8}购买|仅支持.{0,6}客户端/i.test(text))
        return "此页面需要打开商城 App，请在手机完成操作。";
      return null;
    }
    if (
      /\/signIn|\/signin|idmsa\.apple\.com|account\.apple\.com/.test(
        page.url(),
      ) ||
      (await page.locator('input[type="password"]:visible').count())
    )
      return "请在浏览器中完成 Apple 账户登录及双重认证。";
    return null;
  }

  async unique(locator: Locator): Promise<Locator | null> {
    const matches: Locator[] = [];
    const count = await locator.count();
    if (count > 30) throw new NeedsUser("匹配控件过多，请配置更精确的唯一控件。");
    for (let i = 0; i < count; i++)
      if (await locator.nth(i).isVisible()) matches.push(locator.nth(i));
    if (matches.length > 1)
      throw new NeedsUser(
        "页面存在多个匹配控件，已暂停。请使用高级适配指定唯一控件。",
      );
    return matches[0] ?? null;
  }

  async control(
    override: string,
    name: RegExp,
    builtIn?: string,
  ): Promise<Locator | null> {
    const page = await this.getPage();
    if (override) return this.unique(page.locator(override));
    if (builtIn) {
      const match = await this.unique(page.locator(builtIn));
      if (match) return match;
    }
    const button = await this.unique(page.getByRole("button", { name }));
    return button ?? this.unique(page.getByRole("link", { name }));
  }

  async selectChoice(
    label: string,
    override: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    const page = await this.getPage();
    signal.throwIfAborted();
    const issue = await this.intervention();
    if (issue) throw new NeedsUser(issue);
    const regex = new RegExp(
      escapeRegExp(label).replace(/(\d)(GB|TB)/i, "$1\\s*$2"),
      "i",
    );
    let target: Locator | null = null;
    if (override) target = await this.unique(page.locator(override));
    else {
      const radio = await this.unique(page.getByRole("radio", { name: regex }));
      if (radio) {
        if (await radio.isDisabled()) return false;
        if (await radio.isChecked()) return true;
        const id = await radio.getAttribute("id");
        // Apple radio inputs sit underneath their visible labels.
        if (id)
          target = await this.unique(
            page.locator(`label[for=${JSON.stringify(id)}]`),
          );
        target ??= radio;
      } else
        target = await this.unique(
          page.locator("label").filter({ hasText: regex }),
        );
      target ??= await this.unique(page.getByRole("button", { name: regex }));
    }
    if (!target || (await target.isDisabled())) return false;
    if (await target.evaluate((element) => {
      const id = element.getAttribute("for");
      const input = (id ? document.getElementById(id) : element) as HTMLInputElement | null;
      return input?.checked === true || element.getAttribute("aria-checked") === "true" || element.getAttribute("aria-pressed") === "true";
    })) return true;
    signal.throwIfAborted();
    this.access.assertAllowed(this.platform);
    await target.click();
    await this.settle(signal);
    return target.evaluate((element) => {
      const id = element.getAttribute("for");
      const input = (
        id
          ? document.getElementById(id)
          : element.matches("input")
            ? element
            : element.querySelector("input")
      ) as HTMLInputElement | null;
      return (
        input?.checked === true ||
        element.getAttribute("aria-checked") === "true" ||
        element.getAttribute("aria-pressed") === "true"
      );
    });
  }

  async configure(settings: Settings, signal: AbortSignal): Promise<boolean> {
    if (
      !(await this.selectChoice(
        settings.color,
        settings.selectors.color,
        signal,
      ))
    )
      return false;
    if (
      !(await this.selectChoice(
        settings.capacity,
        settings.selectors.capacity,
        signal,
      ))
    )
      return false;
    const page = await this.getPage();
    for (const label of ["不折抵换购", "不加 AppleCare+ 服务计划"]) {
      const radio = await this.unique(
        page.getByRole("radio", {
          name: new RegExp("^" + escapeRegExp(label)),
        }),
      );
      if (radio && (await radio.isEnabled()) && !(await radio.isChecked())) {
        if (!(await this.selectChoice(label, "", signal)))
          throw new NeedsUser("请手动确认折抵换购或 AppleCare+ 选项。");
      }
    }
    return true;
  }

  async probe(settings: Settings): Promise<Probe> {
    const page = await this.open(settings.productUrl);
    const note = await this.intervention();
    const add = note ? null : await this.addButton(settings);
    const selected = !!add && (await add.isEnabled());
    const text = this.allowed(page.url()) ? await this.mainText() : "";
    return {
      platform: this.platform,
      at: new Date().toISOString(),
      title: await page.title(),
      url: publicUrl(page.url()),
      selectable: selected,
      note:
        note ??
        (selected
          ? `已识别可用的${this.flow === "cart" ? "加入购物袋" : "立即购买"}按钮；本次检查未选配或下单。`
          : /接受预购|开始预购|预购将于/.test(text)
            ? "官网显示预购信息。请在开售前完成登录，并保持本机唤醒。"
            : `已连接${this.label}，尚未识别可用的购买按钮。`),
    };
  }

  async addButton(settings: Settings) {
    return this.control(
      settings.selectors.addToBag,
      /^(?:添加到购物袋|加入购物袋|Add to Bag)$/i,
      '[data-autom="add-to-cart"]',
    );
  }

  async assertBagEmpty(signal?: AbortSignal) {
    const page = await this.open(BAG_URL, { signal });
    const issue = await this.intervention();
    if (issue) throw new NeedsUser(issue);
    const text = await this.mainText();
    if (
      !/(?:购物袋|购物车).{0,8}(?:是空的|为空|空空如也|没有商品)|Your Bag is empty/i.test(
        text,
      )
    ) {
      throw new NeedsUser(
        "开始前需要空购物袋。请先在官网核对、移除现有商品，然后点击“继续执行”。",
      );
    }
    return page;
  }

  async openBag() {
    await this.open(BAG_URL);
  }

  async isCheckout() {
    const page = await this.getPage();
    return this.allowed(page.url()) && new URL(page.url()).pathname.startsWith("/shop/checkout");
  }

  async captureProductUrl(): Promise<string> {
    const page = await this.getPage();
    if (!productId(page.url(), this.platform)) throw new NeedsUser("当前不是可识别的完整商品详情页，请先在浏览器中打开目标商品。");
    return page.url();
  }

  async readOrder(settings: Settings): Promise<OrderEvidence> {
    const page = await this.getPage();
    await this.mainText();
    const items = page.locator(settings.selectors.lineItems || ITEM_SELECTOR);
    const result: OrderEvidence["items"] = [];
    for (let i = 0; i < Math.min(await items.count(), 20); i++) {
      const item = items.nth(i);
      if (!(await item.isVisible())) continue;
      const name = await item.innerText();
      const quantities = item.locator(
        'select, input[type="number"], [data-autom="item-quantity"], [data-autom="quantity"]',
      );
      let quantity: number | null = null;
      const values: number[] = [];
      for (let j = 0; j < (await quantities.count()); j++) {
        const field = quantities.nth(j);
        if (!(await field.isVisible())) continue;
        const tag = await field.evaluate((el) => el.tagName);
        const value = ["INPUT", "SELECT"].includes(tag)
          ? await field.inputValue()
          : await field.innerText();
        if (/^\s*\d+\s*$/.test(value)) values.push(Number(value));
      }
      if (values.length === 1) quantity = values[0];
      if (values.length === 0) {
        const match = name.match(
          /(?:数量|Quantity)\s*[:：]?\s*(\d+)(?![\d.,])/i,
        );
        if (match) quantity = Number(match[1]);
      }
      result.push({ name, quantity });
    }
    const totals = settings.selectors.total
      ? page.locator(settings.selectors.total)
      : page.locator(
          '[data-autom="bag-total-value"], [data-autom="checkout-order-total"], [data-autom="order-total"], .rs-summary-total .rs-summary-value',
        );
    let total: number | null = null;
    const visibleTotals: string[] = [];
    for (let i = 0; i < (await totals.count()); i++)
      if (await totals.nth(i).isVisible())
        visibleTotals.push(await totals.nth(i).innerText());
    if (visibleTotals.length === 1) total = parseCny(visibleTotals[0]);
    const selectedPayment = await page
      .locator('main input[type="radio"]:checked')
      .evaluateAll((inputs) =>
        inputs
          .map((input) => {
            const element = input as HTMLInputElement;
            return [
              element.value,
              ...Array.from(element.labels ?? []).map(
                (label) => label.innerText,
              ),
            ].join(" ");
          })
          .join(" "),
      );
    return {
      items: result,
      total,
      checkout: /\/shop\/(?:checkout|bag)(?:\/|$)/.test(
        new URL(page.url()).pathname,
      ),
      installment: /分期|installment|monthly/i.test(selectedPayment),
    };
  }

  async checkoutButton(settings: Settings) {
    return this.control(
      settings.selectors.checkout,
      /^(?:结账|立即结账|前往结账|Check Out|Checkout)$/i,
      '[data-autom="bag-checkout-button"]',
    );
  }

  async submitButton(settings: Settings) {
    return this.control(
      settings.selectors.submit,
      FINAL_NAME,
      '[data-autom="place-order"], [data-autom="checkout-place-order"]',
    );
  }

  async nextCheckoutButton() {
    return this.control(
      "",
      /^(?:继续选择送货选项|继续选择送货方式|继续选择送货地址|继续选择付款方式|继续查看订单|使用此送货地址|使用此地址|查看订单|Continue to Shipping|Continue to Payment|Review Order)$/i,
    );
  }

  async hasEmptyRequiredFields(): Promise<boolean> {
    const page = await this.getPage();
    return page
      .locator(
        'main input[required]:visible, main select[required]:visible, main textarea[required]:visible, main input[aria-required="true"]:visible',
      )
      .evaluateAll((fields) =>
        fields.some((field) => {
          const input = field as HTMLInputElement;
          if (input.disabled) return false;
          if (input.type === "radio" && input.name)
            return !Array.from(
              document.querySelectorAll<HTMLInputElement>(
                'input[type="radio"]',
              ),
            ).some(
              (other) =>
                other.name === input.name &&
                other.form === input.form &&
                other.checked,
            );
          return input.type === "checkbox"
            ? !input.checked
            : !input.value.trim();
        }),
      );
  }

  async isConfirmed(): Promise<boolean> {
    const page = await this.getPage();
    if (!isAppleUrl(page.url())) return false;
    const text = await this.mainText();
    return (
      /\/shop\/(?:order|checkout)\/(?:thankyou|confirmation|orderconfirmation)/i.test(
        page.url(),
      ) && /订单号|订单编号|Order Number/i.test(text)
    );
  }

  async click(control: Locator, signal: AbortSignal) {
    signal.throwIfAborted();
    await this.access.flush(); this.access.assertAllowed(this.platform);
    if (!this.allowed((await this.getPage()).url()))
      throw new NeedsUser(`当前页面不属于${this.label}。`);
    await control.click();
    await this.settle(signal);
  }
}
