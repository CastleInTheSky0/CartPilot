import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserState, BrowserTab, Platform } from "../../../shared/contracts/browser.ts";

interface TabList {
  key: string | null;
  status: "idle" | "loading" | "loaded" | "error";
  tabs: BrowserTab[];
  tabId: string;
  error: string;
}

const EMPTY_LIST: TabList = { key: null, status: "idle", tabs: [], tabId: "", error: "" };

export function useBrowserTabs(
  platform: Platform,
  connection: BrowserState["connection"] | undefined,
) {
  const key = connection?.phase === "connected" ? `${connection.connectedAt}:${platform}` : null;
  const revision = useRef(0);
  const [list, setList] = useState<TabList>(EMPTY_LIST);

  const refresh = useCallback(async () => {
    if (!key) return;
    const request = ++revision.current;
    setList((current) => ({
      ...(current.key === key ? current : EMPTY_LIST),
      key,
      status: "loading",
      error: "",
    }));
    try {
      const tabs = await window.cartPilot.listBrowserTabs(platform);
      if (request !== revision.current) return;
      setList((current) => ({
        key,
        status: "loaded",
        tabs,
        tabId: tabs.some((tab) => tab.id === current.tabId) ? current.tabId : (tabs[0]?.id ?? ""),
        error: "",
      }));
    } catch (failure) {
      if (request !== revision.current) return;
      setList({
        ...EMPTY_LIST,
        key,
        status: "error",
        error: failure instanceof Error ? failure.message : "无法读取标签页，请重试。",
      });
    }
  }, [key, platform]);

  useEffect(() => {
    setList(EMPTY_LIST);
    void refresh();
    return () => {
      ++revision.current;
    };
  }, [refresh]);

  const current = list.key === key ? list : EMPTY_LIST;
  return {
    tabs: current.tabs,
    tabId: current.tabId,
    tabsStatus: key && current.status === "idle" ? "loading" : current.status,
    tabsError: current.error,
    setTabId: (tabId: string) => setList((value) => ({ ...value, tabId })),
    list: refresh,
  };
}
