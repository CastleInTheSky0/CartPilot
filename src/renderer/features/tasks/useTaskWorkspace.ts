import { useCallback, useEffect, useRef, useState } from "react";
import type { PurchaseTaskDefinition } from "../../../shared/contracts/purchase-task.ts";
import type { TaskOverview } from "../../../shared/contracts/task-workspace.ts";

export function useTaskWorkspace() {
  const [tasks, setTasks] = useState<TaskOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++revision.current;
    setLoading(true);
    setError("");
    try {
      const result = await window.cartPilot.listPurchaseTasks();
      if (request === revision.current) setTasks(result);
    } catch {
      if (request === revision.current) setError("无法读取任务，请重试刷新。");
    } finally {
      if (request === revision.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      revision.current++;
    };
  }, [refresh]);

  async function create(definition: PurchaseTaskDefinition): Promise<TaskOverview> {
    const result = await window.cartPilot.createPurchaseTask(definition);
    revision.current++;
    setTasks((current) => [result, ...current.filter((item) => item.task.id !== result.task.id)]);
    setLoading(false);
    setError("");
    return result;
  }

  return { tasks, loading, error, refresh, create };
}
