import { useState } from "react";
import { Plus, RefreshCw, ShoppingBag } from "lucide-react";
import { PLATFORM_LABELS } from "../../shared/platform-labels.ts";
import { TaskDetail } from "./TaskDetail.tsx";
import { TaskForm } from "./TaskForm.tsx";
import { formatMoney, formatTime, taskStatus } from "./task-presentation.ts";
import { useTaskWorkspace } from "./useTaskWorkspace.ts";
import styles from "./task-workspace.module.css";

export function TaskWorkspace() {
  const workspace = useTaskWorkspace();
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    workspace.tasks.find((item) => item.task.id === selectedId) ?? workspace.tasks[0];

  if (creating)
    return (
      <TaskForm
        onCancel={() => setCreating(false)}
        onSave={async (definition) => {
          const result = await workspace.create(definition);
          setSelectedId(result.task.id);
          setCreating(false);
          window.scrollTo({ top: 0 });
        }}
      />
    );

  return (
    <div className={styles.workspace}>
      <div className={styles.toolbar}>
        <div>
          <h2>
            购买任务 <small>{workspace.tasks.length.toString().padStart(2, "0")}</small>
          </h2>
          <p>各任务独立保存商品目标、数量与预算。</p>
        </div>
        <div className={styles.actions}>
          <button
            className="button subtle"
            onClick={() => void workspace.refresh()}
            disabled={workspace.loading}
          >
            <RefreshCw size={14} className={workspace.loading ? "spin" : undefined} />
            刷新任务
          </button>
          <button
            className="button primary"
            onClick={() => setCreating(true)}
            disabled={workspace.loading}
          >
            <Plus size={15} />
            新建任务
          </button>
        </div>
      </div>
      {workspace.error && (
        <p role="alert" className={styles.notice}>
          {workspace.error}
        </p>
      )}
      {workspace.loading && workspace.tasks.length === 0 && (
        <p className={styles.empty}>正在读取任务…</p>
      )}
      {!workspace.loading && !workspace.error && workspace.tasks.length === 0 && (
        <div className={styles.empty}>
          <ShoppingBag size={28} />
          <h3>还没有购买任务</h3>
          <p>添加商品详情链接，设置你的第一份购买目标。</p>
        </div>
      )}
      {workspace.tasks.length > 0 && (
        <>
          <div className={styles.tableScroll}>
            <table className={styles.table} aria-label="购买任务列表">
              <thead>
                <tr>
                  <th>任务 / 平台</th>
                  <th>已下单 / 目标</th>
                  <th>可用预算</th>
                  <th>开售时间</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {workspace.tasks.map((overview) => {
                  const { task, progress } = overview;
                  const status = taskStatus(overview);
                  return (
                    <tr key={task.id} data-selected={selected?.task.id === task.id}>
                      <td>
                        <button
                          className={styles.taskButton}
                          aria-pressed={selected?.task.id === task.id}
                          onClick={() => setSelectedId(task.id)}
                        >
                          {task.definition.name}
                        </button>
                        <small className={styles.platforms}>
                          {[
                            ...new Set(
                              task.definition.candidates.map((candidate) => candidate.platform),
                            ),
                          ]
                            .map((platform) => PLATFORM_LABELS[platform])
                            .join(" · ")}
                        </small>
                      </td>
                      <td>
                        {progress.confirmedQuantity} / {progress.targetQuantity} 件
                      </td>
                      <td>{formatMoney(progress.remainingBudgetCents)}</td>
                      <td>{formatTime(task.definition.schedule.launchAt)}</td>
                      <td>
                        <span className={styles.status} data-tone={status.tone}>
                          {status.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {selected && <TaskDetail key={selected.task.id} overview={selected} />}
        </>
      )}
    </div>
  );
}
