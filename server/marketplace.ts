import type { Locator } from "playwright";
import { AppleBrowser, NeedsUser } from "./browser.ts";
import { normalize, parseCny, productId, type OrderEvidence } from "./safety.ts";
import type { Platform, Settings } from "../shared/types.ts";

type Rules = { title: string[]; choices: string; buy: string; items: string[]; total: string[]; quantity: string; seller: string };
// These are conservative desktop-page fallbacks. Unknown layouts require explicit selectors.
const RULES: Record<Exclude<Platform, "apple">, Rules> = {
  jd: {
    title: [".sku-title-name", ".sku-name", "h1"], choices: ".specification-item-sku, #choose-attrs .item, .choose-attrs .item, [role=radio], [role=option]",
    buy: ".bottom-btns-root .first-row, #btn-easybuy, #btn-onkeybuy, #btn-reservation", items: [".goods-suit .goods-item", ".goods-list .goods-item"],
    total: ["#sumPayPriceId", "#payPriceId", ".pay-price"], quantity: '.p-num, .quantity-form input, input.buyNum',
    seller: ".shop-name, .vendor-name",
  },
  taobao: {
    title: ["h1", ".tb-main-title", '[class*="ItemTitle"]'], choices: '.tb-sku li, [class*="skuItem"], [class*="SkuItem"], [role=radio], [role=option]',
    buy: "#J_LinkBuy, .tb-btn-buy a", items: [".order-order .order-item", '[data-testid="order-item"]', '[class*="orderItem"]'],
    total: [".realPay-price", '[data-testid="order-total"]', '[class*="realPayPrice"]'], quantity: '.item-quantity, .quantity, input.text-amount',
    seller: '.shop-name, [class*="shopName"]',
  },
  tmall: {
    title: ["h1", ".tb-detail-hd", '[class*="ItemTitle"]'], choices: '.tb-sku li, [class*="skuItem"], [class*="SkuItem"], [role=radio], [role=option]',
    buy: "#J_LinkBuy, .tb-btn-buy a", items: [".order-order .order-item", '[data-testid="order-item"]', '[class*="orderItem"]'],
    total: [".realPay-price", '[data-testid="order-total"]', '[class*="realPayPrice"]'], quantity: '.item-quantity, .quantity, input.text-amount',
    seller: '.shop-name, [class*="shopName"]',
  },
  douyin: {
    title: ['[data-e2e="product-title"]', "h1"], choices: '[data-e2e="sku-item"], [role=radio], [role=option]',
    buy: '[data-e2e="buy-now"]', items: ['[data-e2e="order-product"]', '[data-testid="order-item"]'],
    total: ['[data-e2e="order-total"]', '[data-testid="order-total"]'], quantity: '[data-e2e="quantity"], .quantity',
    seller: '[data-e2e="shop-name"]',
  },
};
const BUY_NAME = /^(?:立即购买|马上购买|立即抢购|抢购|立刻购买|Buy Now)$/i;
const SUBMIT_NAME = /^(?:提交订单|确认订单|确认并支付|下单并支付|立即下单)$/;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export class MarketplaceBrowser extends AppleBrowser {
  override readonly flow = "direct" as const;
  private get rules() { return RULES[this.platform as Exclude<Platform, "apple">]; }

  private async firstUnique(selectors: string[]): Promise<Locator | null> {
    const page = await this.getPage();
    for (const selector of selectors) {
      const match = await this.unique(page.locator(selector));
      if (match) return match;
    }
    return null;
  }

  private async productTitle(settings?: Settings) {
    const title = await this.firstUnique(settings?.selectors.productTitle ? [settings.selectors.productTitle] : this.rules.title);
    if (!title) throw new NeedsUser("尚未识别唯一的商品标题，请在浏览器检查商品页，或设置标题选择器。");
    const text = await title.innerText();
    if (!normalize(text).includes("iphoneduo") || /手机壳|保护壳|贴膜|保护膜|模型|租赁|二手|适用于|适配/i.test(text))
      throw new NeedsUser("商品标题无法确认为目标 iPhone Duo 新机，请核对商品链接。");
    return text;
  }

  override async captureProductUrl() {
    const url = await super.captureProductUrl();
    await this.productTitle();
    return url;
  }

  private async selected(target: Locator) {
    return target.evaluate((element) => {
      const associated = element.getAttribute("for");
      return [element, element.parentElement, associated ? document.getElementById(associated) : null].some((node) => !!node && (
        (node instanceof HTMLInputElement && node.checked) ||
        node.getAttribute("aria-checked") === "true" || node.getAttribute("aria-pressed") === "true" ||
        node.getAttribute("aria-selected") === "true" || node.getAttribute("data-state") === "checked" ||
        node.getAttribute("data-selected") === "true" ||
        /(?:^|[\s_-])(?:selected|checked|current|active)(?:$|[\s_-])/i.test(node.className.toString())
      ));
    });
  }

  override async selectChoice(label: string, override: string, signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted();
    const page = await this.getPage();
    const issue = await this.intervention();
    if (issue) throw new NeedsUser(issue);
    const regex = new RegExp(`^\\s*${escape(label).replace(/(\d)(GB|TB)/i, "$1\\s*$2")}\\s*(?:无货)?\\s*$`, "i");
    let target = override ? await this.unique(page.locator(override)) : null;
    if (!override) {
      target = await this.unique(page.getByRole("radio", { name: regex }));
      target ??= await this.unique(page.getByRole("option", { name: regex }));
      target ??= await this.unique(page.locator(this.rules.choices).filter({ hasText: regex }));
      target ??= await this.unique(page.getByRole("button", { name: regex }));
    }
    if (!target) throw new NeedsUser("未识别唯一的规格控件，请在浏览器确认规格或补充该平台的规格选择器。");
    if (await target.isDisabled() || await target.getAttribute("aria-disabled") === "true") return false;
    if (await this.selected(target)) return true;
    if (/无货|售罄|缺货/.test((await target.getAttribute("title")) ?? "") || /(?:--lack|disabled)/.test((await target.getAttribute("class")) ?? "")) return false;
    const id = await target.getAttribute("id");
    const labelTarget = id ? await this.unique(page.locator(`label[for=${JSON.stringify(id)}]`)) : null;
    signal.throwIfAborted(); this.access.assertAllowed(this.platform);
    await (labelTarget ?? target).click();
    await this.settle(signal);
    if (!(await this.selected(target))) throw new NeedsUser("已点击配置，但无法确认选中状态。请在浏览器选择目标规格后继续，或补充唯一规格选择器。");
    return true;
  }

  override async configure(settings: Settings, signal: AbortSignal) {
    const page = await this.getPage();
    if (productId(page.url(), this.platform) !== productId(settings.productUrl, this.platform))
      throw new NeedsUser("当前商品编号与配置链接不一致，请在浏览器打开配置的目标商品。");
    await this.productTitle(settings);
    if (/定金|订金|尾款|分阶段付款/.test(await this.mainText()))
      throw new NeedsUser("此商品包含定金或尾款流程，请在平台核对预售条件后手动购买。");
    const color = await this.selectChoice(settings.color, settings.selectors.color, signal);
    if (!color) return false;
    const capacity = await this.selectChoice(settings.capacity, settings.selectors.capacity, signal);
    if (!capacity) return false;
    if (productId((await this.getPage()).url(), this.platform) !== productId(settings.productUrl, this.platform))
      throw new NeedsUser("选配后商品编号发生变化，请停止任务，使用所需规格的完整商品链接重新配置。");
    return true;
  }

  override async addButton(settings: Settings) {
    const page = await this.getPage();
    // Even custom entry selectors must identify a purchase action, never a deposit or reservation.
    const target = await this.control(settings.selectors.addToBag, BUY_NAME, this.rules.buy);
    if (!target) return null;
    const name = (await target.getAttribute("aria-label")) || await target.innerText();
    if (!BUY_NAME.test(name.trim())) return null;
    if (productId(page.url(), this.platform) !== productId(settings.productUrl, this.platform)) return null;
    return target;
  }

  override async assertBagEmpty() { return this.getPage(); }
  override async openBag() { /* Direct-buy flows remain on the website's checkout page. */ }
  override async isCheckout() {
    const page = await this.getPage();
    if (!this.allowed(page.url())) return false;
    const url = new URL(page.url());
    if (this.platform === "jd") return url.hostname === "trade.jd.com" && /^\/shopping\/order\/getOrderInfo.action$/.test(url.pathname);
    if (this.platform === "taobao" || this.platform === "tmall")
      return ["buy.taobao.com", "buy.tmall.com", "buy.m.taobao.com", "buy.m.tmall.com"].includes(url.hostname) && /\/order\/(?:confirm_order|confirmOrder|confirm)(?:\.htm|\.html)?\/?$/.test(url.pathname);
    return ["haohuo.jinritemai.com", "www.douyin.com"].includes(url.hostname) &&
      /^\/(?:ecommerce\/trade\/confirm\/index.html|shopping\/order\/confirm)\/?$/.test(url.pathname);
  }

  override async readOrder(settings: Settings): Promise<OrderEvidence> {
    const page = await this.getPage();
    const text = await this.mainText();
    const container = await this.firstUniqueItems(settings);
    const result: OrderEvidence["items"] = [];
    if (container) for (const item of container) {
      const name = await item.innerText();
      const quantities = item.locator(settings.selectors.quantity || this.rules.quantity);
      const values: number[] = [];
      for (let j = 0; j < await quantities.count(); j++) {
        const field = quantities.nth(j);
        if (!await field.isVisible()) continue;
        const tag = await field.evaluate((el) => el.tagName);
        const value = ["INPUT", "SELECT"].includes(tag) ? await field.inputValue() : await field.innerText();
        const match = value.trim().match(/^(?:[×xX*]\s*)?(\d+)(?:\s*件)?$/);
        if (match) values.push(Number(match[1]));
      }
      const explicit = name.match(/(?:数量|Quantity)\s*[:：]?\s*(\d+)(?![\d.,])/i);
      const quantity = values.length === 1 ? values[0] : values.length === 0 && explicit ? Number(explicit[1]) : null;
      const links = await item.locator("a[href]").evaluateAll((elements) => elements.map((el) => (el as HTMLAnchorElement).href));
      const ids = links.flatMap((link) => { const id = productId(link, this.platform); return id ? [id] : []; });
      if (this.platform === "jd") {
        const sku = await item.getAttribute("data-sku");
        if (sku && /^\d+$/.test(sku)) ids.push(sku);
      }
      const sellerLocator = page.locator(settings.selectors.seller || this.rules.seller);
      const seller = settings.expectedSeller ? await this.unique(sellerLocator) : null;
      result.push({ name, quantity, productIds: [...new Set(ids)], seller: seller ? await seller.innerText() : null });
    }
    const totalField = await this.firstUnique(settings.selectors.total ? [settings.selectors.total] : this.rules.total);
    const payment = await page.locator('input[type="radio"]:checked, [role="radio"][aria-checked="true"]').evaluateAll((inputs) => inputs.map((element) => [
      element.getAttribute("value"), element.getAttribute("aria-label"), element.textContent,
      ...Array.from((element as HTMLInputElement).labels ?? []).map((label) => label.innerText),
    ].join(" ")).join(" "));
    return {
      items: result, total: totalField ? parseCny(await totalField.innerText()) : null,
      checkout: await this.isCheckout(), installment: /分期|白条|花呗分期|installment|monthly/i.test(payment),
      deposit: /定金|订金|尾款|分阶段付款/.test(text),
    };
  }

  private async firstUniqueItems(settings: Settings): Promise<Locator[] | null> {
    const page = await this.getPage();
    for (const selector of settings.selectors.lineItems ? [settings.selectors.lineItems] : this.rules.items) {
      const rows = page.locator(selector);
      const visible: Locator[] = [];
      const count = await rows.count();
      if (count > 30) throw new NeedsUser("订单中商品条目过多，请人工核对。");
      for (let i = 0; i < count; i++) if (await rows.nth(i).isVisible()) visible.push(rows.nth(i));
      if (visible.length) return visible;
    }
    return null;
  }

  override async checkoutButton(_settings: Settings) { return null; }
  override async submitButton(settings: Settings) {
    if (!await this.isCheckout()) return null;
    return this.control(settings.selectors.submit, SUBMIT_NAME,
      this.platform === "jd" ? "#order-submit" : this.platform === "taobao" || this.platform === "tmall" ? ".go-btn" : '[data-e2e="submit-order"]');
  }
  override async nextCheckoutButton() { return null; }

  override async hasEmptyRequiredFields() {
    const page = await this.getPage();
    const fields = page.locator('input[required]:visible, select[required]:visible, textarea[required]:visible');
    return fields.evaluateAll((inputs) => inputs.some((element) => {
      const input = element as HTMLInputElement;
      if (input.disabled) return false;
      if (input.type === "checkbox") return !input.checked;
      if (input.type === "radio") return !Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]')).some((other) => other.name === input.name && other.form === input.form && other.checked);
      return !input.value.trim();
    }));
  }

  override async isConfirmed() {
    const page = await this.getPage();
    if (!this.allowed(page.url())) return false;
    const url = new URL(page.url());
    const known = this.platform === "jd" ? ["success.jd.com", "cashier.jd.com"].includes(url.hostname) :
      this.platform === "taobao" || this.platform === "tmall" ? /^(?:buy|trade)\.(?:taobao|tmall)\.com$/.test(url.hostname) && /\/order\/(?:success|order_success)/.test(url.pathname) :
      /\/trade\/(?:success|pay)|\/shopping\/order\/success/.test(url.pathname);
    return known && /(?:订单号|订单编号)\s*[:：]?\s*[A-Za-z0-9-]{6,}/.test(await this.mainText());
  }
}

export function createBrowser(platform: Platform, onChange: (open: boolean) => void): AppleBrowser {
  return platform === "apple" ? new AppleBrowser(onChange) : new MarketplaceBrowser(onChange, platform);
}
