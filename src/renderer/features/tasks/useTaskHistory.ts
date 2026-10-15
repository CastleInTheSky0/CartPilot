import { useCallback, useEffect, useRef, useState } from "react";
import type { TaskHistory } from "../../../shared/contracts/purchase-history.ts";

export function useTaskHistory(taskId: string) {
  const [history, setHistory] = useState<TaskHistory | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [readAt, setReadAt] = useState<string | null>(null);
  const revision = useRef(0);

  const read = useCallback(
    async (beforeSequence?: number) => {
      const request = ++revision.current;
      setBusy(true);
      setError("");
      try {
        const result = await window.cartPilot.getPurchaseTaskHistory({ taskId, beforeSequence });
        if (request !== revision.current) return;
        setHistory((current) => ({
          ...result,
          events:
            beforeSequence !== undefined && current?.taskId === taskId
              ? [...current.events, ...result.events]
              : result.events,
        }));
        setReadAt(new Date().toISOString());
      } catch {
        if (request === revision.current) setError("无法读取任务历史，请刷新重试。");
      } finally {
        if (request === revision.current) setBusy(false);
      }
    },
    [taskId],
  );

  useEffect(() => {
    void read();
    return () => {
      revision.current++;
    };
  }, [read]);

  return { history, busy, error, readAt, read };
}
