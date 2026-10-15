import {
  ArrowUpRight,
  Check,
  Circle,
  LockKeyhole,
  MonitorCheck,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import type { BrowserState } from "../../../shared/contracts/browser.ts";
import { loginPresentation } from "./browser-presentation.ts";
import styles from "./checklist.module.css";

interface Props {
  state: BrowserState | null;
  onHelp: () => void;
}

export function ConnectionChecklist({ state, onHelp }: Props) {
  const isConnected = state?.connection.phase === "connected";
  const bound = state?.channels.filter((channel) => channel.tab) ?? [];
  const authenticated = bound.filter((channel) => loginPresentation(channel).tone === "ready");
  const steps = [
    {
      title: "连接浏览器扩展",
      detail: isConnected ? "Chrome 已授权连接" : "安装官方扩展，在 Chrome 中授权",
      done: isConnected,
    },
    {
      title: "接入商城标签页",
      detail: bound.length ? `已接入 ${bound.length} 个平台页面` : "选择要使用的商城页面",
      done: bound.length > 0,
    },
    {
      title: "确认商城登录",
      detail: authenticated.length
        ? `${authenticated.length} 个平台已确认登录`
        : "接入后自动读取登录状态",
      done: authenticated.length > 0,
    },
  ];

  return (
    <aside className={styles.panel} aria-labelledby="checklist-heading">
      <div className={styles.heading}>
        <h2 id="checklist-heading">
          <span className="section-number">02</span>准备状态
        </h2>
        <span>{steps.filter((step) => step.done).length} / 3</span>
      </div>
      <div className={styles.summary}>
        <span className={styles.summaryIcon}>
          {isConnected ? <MonitorCheck size={24} /> : <Unplug size={24} />}
        </span>
        <div>
          <strong>{isConnected ? "浏览器已就绪" : "从连接浏览器开始"}</strong>
          <p>{isConnected ? "继续接入页面并检查登录状态。" : "完成三步，准备好你的购买环境。"}</p>
        </div>
      </div>
      <ol className={styles.steps}>
        {steps.map((step, index) => (
          <li key={step.title} data-done={step.done}>
            <span className={styles.stepIcon}>
              {step.done ? <Check size={13} /> : <span>{index + 1}</span>}
            </span>
            <div>
              <strong>{step.title}</strong>
              <p>{step.detail}</p>
            </div>
            {step.done ? (
              <Check size={13} className={styles.complete} />
            ) : (
              <Circle size={5} className={styles.pending} />
            )}
          </li>
        ))}
      </ol>
      <div className={styles.privacy}>
        <ShieldCheck size={15} />
        <p>
          登录和支付留在你的浏览器中。
          <br />
          断开连接后，商城页面仍会保留。
        </p>
      </div>
      <button className={styles.help} onClick={onHelp}>
        查看接入说明
        <ArrowUpRight size={13} />
      </button>
      <div className={styles.local}>
        <LockKeyhole size={11} />
        本机运行 · 自主控制
      </div>
    </aside>
  );
}
