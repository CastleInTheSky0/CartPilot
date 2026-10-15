import { z } from "zod";
import { PLATFORM_LABELS } from "../../shared/platform-labels.ts";
import type { TaskDraft } from "./task-draft.ts";
import styles from "./task-form.module.css";

interface Props {
  draft: TaskDraft;
  onChange: (patch: Partial<TaskDraft>) => void;
}

export function PurchaseRulesFields({ draft, onChange }: Props) {
  const platforms = [...new Set(draft.candidates.map((candidate) => candidate.platform))];
  return (
    <>
      <section className={styles.section} aria-labelledby="quantity-fields-title">
        <h3 id="quantity-fields-title">
          <span className="section-number">03</span> 数量与预算
        </h3>
        <div className={styles.fields}>
          <label>
            数量模式
            <select
              aria-label="数量模式"
              value={draft.quantityMode}
              onChange={(e) =>
                onChange({
                  quantityMode: z.enum(["total", "per_platform"]).parse(e.target.value),
                })
              }
            >
              <option value="total">跨平台合计</option>
              <option value="per_platform">每个平台独立</option>
            </select>
          </label>
          {draft.quantityMode === "total" ? (
            <label>
              任务目标数量
              <input
                required
                type="number"
                min="1"
                max="1000000"
                step="1"
                value={draft.targetQuantity}
                onChange={(e) => onChange({ targetQuantity: e.target.value })}
              />
            </label>
          ) : (
            platforms.map((platform) => (
              <label key={platform}>
                {PLATFORM_LABELS[platform]}目标数量
                <input
                  required
                  type="number"
                  min="1"
                  max="1000000"
                  step="1"
                  value={draft.platformTargets[platform]}
                  onChange={(e) =>
                    onChange({
                      platformTargets: { ...draft.platformTargets, [platform]: e.target.value },
                    })
                  }
                />
              </label>
            ))
          )}
          <label>
            单笔购买数量
            <input
              required
              type="number"
              min="1"
              max="1000000"
              step="1"
              value={draft.orderQuantity}
              onChange={(e) => onChange({ orderQuantity: e.target.value })}
            />
          </label>
        </div>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={draft.allowPartial}
            onChange={(e) => onChange({ allowPartial: e.target.checked })}
          />
          允许减量并分多笔购买
        </label>
        <p className={styles.hint}>
          默认保持单笔数量。关闭时，剩余目标或库存不足一笔会暂停对应候选。
        </p>
        <div className={styles.fields}>
          <label>
            每件最高价（元）
            <input
              required
              inputMode="decimal"
              placeholder="0.00"
              value={draft.maxUnitPrice}
              onChange={(e) => onChange({ maxUnitPrice: e.target.value })}
            />
          </label>
          <label>
            任务总预算（元）
            <input
              required
              inputMode="decimal"
              placeholder="0.00"
              value={draft.totalBudget}
              onChange={(e) => onChange({ totalBudget: e.target.value })}
            />
          </label>
        </div>
        <p className={styles.hint}>各平台、多笔订单共享总预算，按含运费的最终应付金额计算。</p>
      </section>
      <section className={styles.section} aria-labelledby="schedule-fields-title">
        <h3 id="schedule-fields-title">
          <span className="section-number">04</span> 时间与提交方式
        </h3>
        <div className={styles.fields}>
          <label>
            开售时间
            <input
              required
              type="datetime-local"
              value={draft.launchAt}
              onChange={(e) => onChange({ launchAt: e.target.value })}
            />
          </label>
          <label>
            最长运行时间（分钟）
            <input
              required
              type="number"
              min="1"
              max="120"
              step="1"
              value={draft.maxRunMinutes}
              onChange={(e) => onChange({ maxRunMinutes: e.target.value })}
            />
          </label>
          <label>
            提交方式
            <select
              aria-label="提交方式"
              required
              value={draft.submissionMode}
              onChange={(e) =>
                onChange({
                  submissionMode: z.enum(["", "automatic", "manual"]).parse(e.target.value),
                })
              }
            >
              <option value="" disabled>
                请选择提交方式
              </option>
              <option value="manual">人工确认后提交</option>
              <option value="automatic">符合约束后自动提交</option>
            </select>
          </label>
        </div>
        <p className={styles.hint}>时间按本机时区填写。自动提交可生成订单，支付始终由你完成。</p>
      </section>
    </>
  );
}
