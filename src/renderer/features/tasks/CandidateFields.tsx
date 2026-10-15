import { PlatformSchema } from "../../../shared/contracts/browser.ts";
import { PLATFORM_LABELS } from "../../shared/platform-labels.ts";
import { newCandidate, type CandidateDraft } from "./task-draft.ts";
import styles from "./task-form.module.css";

interface Props {
  candidates: CandidateDraft[];
  onChange: (candidates: CandidateDraft[]) => void;
}

export function CandidateFields({ candidates, onChange }: Props) {
  function update(id: string, patch: Partial<CandidateDraft>) {
    onChange(candidates.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  return (
    <section className={styles.section} aria-labelledby="candidate-fields-title">
      <div className={styles.subheading}>
        <h3 id="candidate-fields-title">
          <span className="section-number">02</span> 候选商品
        </h3>
        <button
          type="button"
          className="button"
          disabled={candidates.length >= 50}
          onClick={() => onChange([...candidates, newCandidate()])}
        >
          添加候选
        </button>
      </div>
      <p className={styles.hint}>支持主备链接。同一平台的所有候选共享该平台目标。</p>
      {candidates.map((candidate, index) => (
        <fieldset className={styles.candidate} key={candidate.id}>
          <legend>候选 {index + 1}</legend>
          <div className={styles.candidateMain}>
            <label>
              平台
              <select
                aria-label="平台"
                value={candidate.platform}
                onChange={(e) =>
                  update(candidate.id, { platform: PlatformSchema.parse(e.target.value) })
                }
              >
                {PlatformSchema.options.map((platform) => (
                  <option value={platform} key={platform}>
                    {PLATFORM_LABELS[platform]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              商品详情链接
              <input
                required
                type="url"
                maxLength={4000}
                placeholder="粘贴 HTTPS 完整商品详情链接"
                value={candidate.productUrl}
                onChange={(e) => update(candidate.id, { productUrl: e.target.value })}
              />
            </label>
            <button
              type="button"
              className="button subtle"
              disabled={candidates.length === 1}
              aria-label={`移除候选 ${index + 1}`}
              onClick={() => onChange(candidates.filter((item) => item.id !== candidate.id))}
            >
              移除
            </button>
          </div>
          <details className={styles.details}>
            <summary>店铺、商品编号与独立开售时间（可选）</summary>
            <div className={styles.fields}>
              <label>
                指定店铺
                <input
                  maxLength={200}
                  value={candidate.expectedSeller}
                  onChange={(e) => update(candidate.id, { expectedSeller: e.target.value })}
                />
              </label>
              <label>
                独立开售时间
                <input
                  type="datetime-local"
                  value={candidate.launchAt}
                  onChange={(e) => update(candidate.id, { launchAt: e.target.value })}
                />
              </label>
              <label>
                商品编号
                <input
                  maxLength={200}
                  value={candidate.productId}
                  onChange={(e) => update(candidate.id, { productId: e.target.value })}
                />
              </label>
              <label>
                SKU 编号
                <input
                  maxLength={200}
                  value={candidate.skuId}
                  onChange={(e) => update(candidate.id, { skuId: e.target.value })}
                />
              </label>
            </div>
            <p className={styles.hint}>留空时在页面准备时核对；独立开售时间留空则使用任务时间。</p>
          </details>
        </fieldset>
      ))}
    </section>
  );
}
