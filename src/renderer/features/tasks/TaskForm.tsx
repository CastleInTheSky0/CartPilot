import { useState } from "react";
import type { PurchaseTaskDefinition } from "../../../shared/contracts/purchase-task.ts";
import { CandidateFields } from "./CandidateFields.tsx";
import { ProductFields } from "./ProductFields.tsx";
import { PurchaseRulesFields } from "./PurchaseRulesFields.tsx";
import { newTaskDraft, taskDefinition, taskFormError, type TaskDraft } from "./task-draft.ts";
import styles from "./task-form.module.css";

interface Props {
  onSave: (definition: PurchaseTaskDefinition) => Promise<void>;
  onCancel: () => void;
}

export function TaskForm({ onSave, onCancel }: Props) {
  const [draft, setDraft] = useState(newTaskDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = (patch: Partial<TaskDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setError("");
  };

  async function save() {
    if (busy) return;
    setError("");
    try {
      const definition = taskDefinition(draft);
      setBusy(true);
      await onSave(definition);
    } catch (cause: unknown) {
      setError(taskFormError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={styles.form}
      aria-label="新建购买任务"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className={styles.heading}>
        <div>
          <h2>新建购买任务</h2>
          <p>设置商品、数量和预算，保存后可检查任务详情。</p>
        </div>
        <button type="button" className="button subtle" disabled={busy} onClick={onCancel}>
          取消
        </button>
      </div>
      <fieldset disabled={busy} className={styles.body}>
        <ProductFields draft={draft} onChange={update} />
        <CandidateFields
          candidates={draft.candidates}
          onChange={(candidates) => update({ candidates })}
        />
        <PurchaseRulesFields draft={draft} onChange={update} />
      </fieldset>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <p>保存后处于待复核状态。通用页面准备与执行功能正在接入。</p>
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? "正在保存…" : "保存任务"}
        </button>
      </div>
    </form>
  );
}
