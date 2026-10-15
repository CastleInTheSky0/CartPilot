import type { Page } from "playwright";
import { PLATFORM_INFO, type LoginStatus, type Platform } from "../shared/types.ts";
import { isPlatformUrl } from "./safety.ts";

export function unknownLogin(reason: LoginStatus["reason"] = "browser_closed"): LoginStatus {
  const messages: Partial<Record<LoginStatus["reason"], string>> = {
    browser_closed: "尚未打开此平台的执行窗口，登录状态未检测。",
    page_changed: "执行页面正在切换，等待重新检测登录状态。",
    stale: "上次检测已过期，请重新检测或查看执行窗口。",
    unavailable: "暂时无法读取执行页面，请查看浏览器后重新检测。",
  };
  return { state: "unknown", reason, message: messages[reason] ?? "当前页面没有足够的登录信息，请查看执行窗口。", checkedAt: null };
}

// Only explicit, visible account controls count as positive evidence. Cookie
// presence and the absence of a login form do not establish authentication.
const ACCOUNT_CONTROLS: Record<Platform, string> = {
  apple: '[data-autom="accountName"], [data-autom="account-name"], [data-autom="signOut"], [data-autom="sign-out"], [data-autom="signout"]',
  jd: '#ttbar-login .nickname, #ttbar-login2014 .nickname, #ttbar-login-2024 .nickname, #shortcut .nickname, #ttbar-login .user-nickname, #ttbar-login-2024 .user-nickname, a[href*="passport.jd.com/uc/login?ltype=logout"]',
  taobao: '#J_SiteNavLogin .site-nav-login-info-nick, #J_SiteNavLogin .site-nav-user-info, #sn-login-info .sn-user-nick',
  tmall: '#J_SiteNavLogin .site-nav-login-info-nick, #J_SiteNavLogin .site-nav-user-info, #sn-login-info .sn-user-nick',
  douyin: '[data-e2e="user-info"] [data-e2e="user-nickname"], [data-e2e="user-menu"] [data-e2e="user-nickname"]',
};
const GUEST_CONTROLS: Record<Platform, string> = {
  apple: '[data-autom="signIn"], [data-autom="sign-in"], [data-autom="signin"]',
  jd: '#ttbar-login .link-login, #ttbar-login2014 .link-login, #ttbar-login-2024 .link-login, #shortcut .link-login',
  taobao: '#J_SiteNavLogin .site-nav-sign a, #sn-login-info .sn-login',
  tmall: '#J_SiteNavLogin .site-nav-sign a, #sn-login-info .sn-login',
  douyin: '[data-e2e="top-login-button"], [data-e2e="login-button"]',
};

export async function readLoginStatus(page: Page | null, platform: Platform): Promise<LoginStatus> {
  if (!page || page.isClosed()) return unknownLogin();
  const url = page.url();
  if (!isPlatformUrl(url, platform)) return { ...unknownLogin("unrecognized"), checkedAt: new Date().toISOString() };
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const evidence = await Promise.race([
      page.evaluate(({ accountSelector, guestSelector }) => {
        const dom = {
          visible(element: Element) {
            if (!element.getClientRects().length || element.closest('[hidden], [aria-hidden="true"]')) return false;
            const style = getComputedStyle(element);
            return style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse";
          },
          anyVisible(selector: string) { return [...document.querySelectorAll(selector)].some((element) => dom.visible(element)); },
          name(element: Element) { return (element.getAttribute("aria-label") || (element as HTMLElement).innerText || "").trim(); },
        };
        const text = document.body?.innerText ?? "";
        const controls = [...document.querySelectorAll('a, button, [role="button"]')].filter((element) => dom.visible(element));
        return {
          url: location.href,
          loading: document.readyState === "loading",
          verification: dom.anyVisible('iframe[src*="captcha"], iframe[title*="验证码"], iframe[title*="CAPTCHA"]') ||
            /验证你是人类|验证您是人类|请输入验证码|安全验证|访问被拒绝|拖动.{0,12}滑块|点击.{0,8}验证|访问过于频繁|操作过于频繁|access denied|too many requests/i.test(text),
          expired: /登录(?:状态|信息|凭证|会话)?(?:已)?(?:过期|失效)|请重新登录|请重新登陆|session (?:has )?expired/i.test(text),
          loginForm: dom.anyVisible('input[type="password"], iframe[src*="login.taobao.com"], iframe[src*="login.tmall.com"], iframe[src*="passport.jd.com"], iframe[title*="登录"], iframe[src*="idmsa.apple.com"][src*="auth"]'),
          account: [...document.querySelectorAll(accountSelector)].some((element) => dom.visible(element) && !!dom.name(element)) ||
            controls.some((element) => /^(?:退出登录|退出登陆|退出账户|退出帐户|登出|注销登录|sign out|log out)$/i.test(dom.name(element))),
          guest: dom.anyVisible(guestSelector) || controls.some((element) =>
            !!element.closest('header, nav, #shortcut, #ttbar, #ttbar-login, #ttbar-login2014, #ttbar-login-2024, #J_SiteNav, #sn-login-info, .site-nav') &&
            /^(?:你好，?请登录|您好，?请登录|亲，请登录|请登录|登录|立即登录|登录账户|登录帐户|sign in|log in)$/i.test(dom.name(element))),
        };
      }, { accountSelector: ACCOUNT_CONTROLS[platform], guestSelector: GUEST_CONTROLS[platform] }),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("login read timed out")), 3000); timeout.unref(); }),
    ]);
    if (page.isClosed()) return unknownLogin();
    if (url !== page.url() || evidence.url !== url || evidence.loading) return unknownLogin("page_changed");
    const checkedAt = new Date().toISOString();
    const status = (state: LoginStatus["state"], reason: LoginStatus["reason"], message: string): LoginStatus => ({ state, reason, message, checkedAt });
    if (evidence.verification) return status("unknown", "verification", "页面要求安全验证或限制了访问，请在执行窗口处理后重新检测。");
    const parsed = new URL(url);
    const loginPage = /^(?:login|passport|idmsa)\./i.test(parsed.hostname) || /\/(?:sign-?in|login)(?:[/.]|$)/i.test(parsed.pathname);
    if (evidence.expired || evidence.loginForm || loginPage)
      return status("logged_out", "login_required", evidence.expired ? "页面提示登录已失效，请在执行窗口重新登录。" : `请在${PLATFORM_INFO[platform].name}执行窗口完成登录。`);
    if (evidence.account && !evidence.guest) return status("logged_in", "authenticated", "在此平台执行窗口检测到已登录的账户控件。");
    if (evidence.guest && !evidence.account) return status("logged_out", "login_required", "当前执行页面显示未登录，请在该窗口完成登录。");
    return status("unknown", "unrecognized", "当前页面未提供明确的登录信息；可打开账户菜单，再点击重新检测。");
  } catch {
    return page.isClosed() ? unknownLogin() : { ...unknownLogin("unavailable"), checkedAt: new Date().toISOString() };
  } finally { clearTimeout(timeout); }
}
