import { useCallback, useEffect, useState } from "react";
import type { BrowserState, Platform } from "../../../shared/contracts/browser.ts";
import { useBrowserTabs } from "./useBrowserTabs.ts";

export function useBrowserConnection() {
  const [state, setState] = useState<BrowserState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [platform, setPlatform] = useState<Platform>("jd");
  const [profile, setProfile] = useState("");
  const browserTabs = useBrowserTabs(platform, state?.connection);

  useEffect(() => {
    let active = true;
    const unsubscribe = window.cartPilot.onBrowserStateChanged((value) => {
      if (active) setState(value);
    });
    void window.cartPilot.getBrowserState().then(
      (value) => {
        if (active) setState(value);
      },
      () => {
        if (active) setError("无法读取浏览器状态，请重新启动应用。");
      },
    );
    void window.cartPilot.getBrowserPreferences().then(
      (value) => {
        if (active) setProfile(value.profileDirectory ?? "");
      },
      () => {
        if (active) setError("无法读取已保存的 Chrome 资料目录。");
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const run = useCallback(async (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "操作失败，请重试。");
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    state,
    profile,
    setProfile,
    error,
    busy,
    platform,
    ...browserTabs,
    setPlatform,
    connect: (profile: string) =>
      run(async () => {
        setState(
          await window.cartPilot.connectBrowser({ profileDirectory: profile.trim() || null }),
        );
      }),
    disconnect: () =>
      run(async () => {
        setState(await window.cartPilot.disconnectBrowser());
      }),
    install: () => run(() => window.cartPilot.openExtensionInstall()),
    bind: () =>
      run(async () => {
        setState(await window.cartPilot.bindBrowserTab({ platform, tabId: browserTabs.tabId }));
      }),
    refresh: (target: Platform) =>
      run(async () => {
        setState(await window.cartPilot.refreshBrowserLogin(target));
      }),
    focus: (target: Platform) =>
      run(async () => {
        setState(await window.cartPilot.focusBrowserTab(target));
      }),
  };
}

export type BrowserConnection = ReturnType<typeof useBrowserConnection>;
