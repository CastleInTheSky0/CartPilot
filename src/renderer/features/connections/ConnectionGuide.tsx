import { ArrowRight, Globe2, MousePointer2, ShieldCheck } from "lucide-react";
import styles from "./guide.module.css";

const STEPS = [
  {
    icon: Globe2,
    title: "安装扩展，连接 Chrome",
    description:
      "在工作台打开官方扩展安装页，安装后点击“连接普通 Chrome”，在浏览器里允许本次连接。",
    note: "复用日常浏览器，无需重新迁移登录信息。",
  },
  {
    icon: MousePointer2,
    title: "选择你要接入的商城页面",
    description:
      "在 Chrome 打开商城页面，回到工作台选择平台、刷新标签列表，再接入对应标签页。每个平台分别选择。",
    note: "助手只读取你明确接入的页面及其打开的弹窗。",
  },
  {
    icon: ShieldCheck,
    title: "检查商城登录状态",
    description:
      "在下方渠道列表查看检测结果。需要登录或验证码时，到对应浏览器页面完成，再点击“重新检测”。",
    note: "扩展连接、标签页接入与商城登录是三项独立状态。",
  },
];

export function ConnectionGuide({ onStart }: { onStart: () => void }) {
  return (
    <section className={styles.guide} aria-label="浏览器接入说明">
      <div className={styles.intro}>
        <span className="section-number">GUIDE</span>
        <h2>三步完成浏览器接入</h2>
        <p>你的登录信息留在 Chrome 中，连接和断开均由你控制。</p>
      </div>
      <ol className={styles.steps}>
        {STEPS.map((step, index) => (
          <li key={step.title}>
            <div className={styles.icon}>
              <step.icon size={21} />
            </div>
            <div>
              <span className={styles.stepNumber}>STEP 0{index + 1}</span>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
              <small>{step.note}</small>
            </div>
          </li>
        ))}
      </ol>
      <div className={styles.bottom}>
        <p>断开连接会释放控制，保留已经打开的浏览器页面。</p>
        <button className="button primary" onClick={onStart}>
          返回工作台
          <ArrowRight size={14} />
        </button>
      </div>
    </section>
  );
}
