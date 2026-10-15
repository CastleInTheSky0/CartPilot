import { ArrowRight, Globe2, MousePointer2, ShieldCheck } from "lucide-react";
import styles from "./guide.module.css";

const STEPS = [
  {
    icon: Globe2,
    title: "安装扩展，连接 Chrome",
    description:
      "先在日常 Chrome 打开商城页面，安装官方扩展后点击“连接普通 Chrome”。在授权页找到商城页面，点击它旁边的“Allow & select”。",
    note: "复用日常浏览器，无需重新迁移登录信息。",
  },
  {
    icon: MousePointer2,
    title: "选择你要接入的商城页面",
    description:
      "回到“浏览器连接”选择平台，列表自动读取已授权页面。新增页面时，将标签页拖入 Chrome 的“CartPilot 购买助手”标签组，再刷新列表并接入。每个平台分别选择。",
    note: "仅打开网页还不够；页面须在本次连接的 Chrome 资料与授权标签组中。",
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
          前往浏览器连接
          <ArrowRight size={14} />
        </button>
      </div>
    </section>
  );
}
