import type { TaskDraft } from "./task-draft.ts";
import styles from "./task-form.module.css";

interface Props {
  draft: TaskDraft;
  onChange: (patch: Partial<TaskDraft>) => void;
}

export function ProductFields({ draft, onChange }: Props) {
  return (
    <section className={styles.section} aria-labelledby="product-fields-title">
      <h3 id="product-fields-title">
        <span className="section-number">01</span> 商品与规格
      </h3>
      <div className={styles.fields}>
        <label>
          任务名称
          <input
            required
            maxLength={200}
            value={draft.name}
            placeholder="例如：跑鞋秋季补货"
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </label>
        <label>
          商品名称
          <input
            required
            maxLength={200}
            value={draft.productName}
            placeholder="填写需要核对的完整商品名称"
            onChange={(e) => onChange({ productName: e.target.value })}
          />
        </label>
      </div>
      <div className={styles.subheading}>
        <span>
          规格要求 <small>没有规格要求可留空</small>
        </span>
        <button
          type="button"
          className="button subtle"
          disabled={draft.specifications.length >= 30}
          onClick={() =>
            onChange({
              specifications: [
                ...draft.specifications,
                { id: crypto.randomUUID(), name: "", value: "" },
              ],
            })
          }
        >
          添加规格
        </button>
      </div>
      {draft.specifications.map((row, index) => (
        <div className={styles.specification} key={row.id}>
          <label>
            规格名称 {index + 1}
            <input
              required
              maxLength={60}
              value={row.name}
              placeholder="例如：尺码"
              onChange={(e) =>
                onChange({
                  specifications: draft.specifications.map((item) =>
                    item.id === row.id ? { ...item, name: e.target.value } : item,
                  ),
                })
              }
            />
          </label>
          <label>
            规格值 {index + 1}
            <input
              required
              maxLength={200}
              value={row.value}
              placeholder="例如：42"
              onChange={(e) =>
                onChange({
                  specifications: draft.specifications.map((item) =>
                    item.id === row.id ? { ...item, value: e.target.value } : item,
                  ),
                })
              }
            />
          </label>
          <button
            type="button"
            className="button subtle"
            aria-label={`移除规格 ${index + 1}`}
            onClick={() =>
              onChange({
                specifications: draft.specifications.filter((item) => item.id !== row.id),
              })
            }
          >
            移除
          </button>
        </div>
      ))}
    </section>
  );
}
