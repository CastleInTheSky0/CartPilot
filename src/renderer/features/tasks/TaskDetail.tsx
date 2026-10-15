import type { TaskOverview } from "../../../shared/contracts/task-workspace.ts";
import { PLATFORM_LABELS } from "../../shared/platform-labels.ts";
import { formatMoney, formatTime, taskStatus } from "./task-presentation.ts";
import styles from "./task-workspace.module.css";

export function TaskDetail({ overview }: { overview: TaskOverview }) {
  const { task, progress } = overview;
  const definition = task.definition;
  const status = taskStatus(overview);
  return (
    <section className={styles.detail} aria-label="任务详情">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.kicker}>任务详情</p>
          <h2>{definition.name}</h2>
        </div>
        <span className={styles.status} data-tone={status.tone}>
          {status.label}
        </span>
      </div>
      <p className={styles.notice}>
        任务已保存在本机。通用页面准备与执行功能正在接入，当前需要复核购买设置。
      </p>
      <dl className={styles.facts}>
        <div>
          <dt>商品</dt>
          <dd>{definition.product.name}</dd>
        </div>
        <div>
          <dt>规格</dt>
          <dd>
            {Object.entries(definition.product.specifications)
              .map(([key, value]) => `${key}：${value}`)
              .join(" / ") || "未指定规格"}
          </dd>
        </div>
        <div>
          <dt>已下单 / 目标</dt>
          <dd>
            {progress.confirmedQuantity} / {progress.targetQuantity} 件
          </dd>
        </div>
        <div>
          <dt>数量模式</dt>
          <dd>{definition.quantityPlan.mode === "total" ? "跨平台合计" : "每个平台独立"}</dd>
        </div>
        <div>
          <dt>已下单金额</dt>
          <dd>{formatMoney(progress.spentCents)}</dd>
        </div>
        <div>
          <dt>剩余可用预算</dt>
          <dd>{formatMoney(progress.remainingBudgetCents)}</dd>
        </div>
        <div>
          <dt>总预算 / 每件最高价</dt>
          <dd>
            {formatMoney(definition.budget.totalBudgetCents)} /{" "}
            {formatMoney(definition.budget.maxUnitPriceCents)}
          </dd>
        </div>
        <div>
          <dt>单笔数量 / 减量拆单</dt>
          <dd>
            {definition.orderQuantity} 件 / {definition.allowPartial ? "允许" : "关闭"}
          </dd>
        </div>
        <div>
          <dt>开售时间</dt>
          <dd>{formatTime(definition.schedule.launchAt)}</dd>
        </div>
        <div>
          <dt>最长运行时间</dt>
          <dd>{definition.schedule.maxRunMinutes} 分钟</dd>
        </div>
        <div>
          <dt>提交方式</dt>
          <dd>
            {definition.submissionMode === "automatic" ? "符合约束后自动提交" : "人工确认后提交"}
          </dd>
        </div>
        <div>
          <dt>创建时间</dt>
          <dd>{formatTime(task.createdAt)}</dd>
        </div>
      </dl>
      <h3 className={styles.subheading}>平台进度</h3>
      <div className={styles.tableScroll}>
        <table className={styles.table} aria-label="平台进度">
          <thead>
            <tr>
              <th>平台</th>
              <th>已下单 / 目标</th>
              <th>提交待核对</th>
              <th>执行预留</th>
            </tr>
          </thead>
          <tbody>
            {progress.byPlatform.map((item) => (
              <tr key={item.platform}>
                <td>{PLATFORM_LABELS[item.platform]}</td>
                <td>
                  {item.confirmedQuantity} / {item.targetQuantity ?? "共享目标"}
                </td>
                <td>{item.pendingQuantity} 件</td>
                <td>{item.reservedQuantity} 件</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.hint}>
        待核对与执行预留占用数量和预算；取消、关闭或支付超时的已确认订单保留进度。
      </p>
      <h3 className={styles.subheading}>
        候选商品 <small>{definition.candidates.length}</small>
      </h3>
      <ol className={styles.candidates}>
        {definition.candidates.map((candidate, index) => (
          <li key={candidate.id}>
            <strong>
              {String(index + 1).padStart(2, "0")} · {PLATFORM_LABELS[candidate.platform]}
            </strong>
            <p>{candidate.productUrl}</p>
            <small>
              {candidate.expectedSeller ? `店铺：${candidate.expectedSeller}` : "店铺未指定"}
              {candidate.productId && ` · 商品编号：${candidate.productId}`}
              {candidate.skuId && ` · SKU：${candidate.skuId}`}
              {candidate.launchAt && ` · 独立开售：${formatTime(candidate.launchAt)}`}
            </small>
          </li>
        ))}
      </ol>
    </section>
  );
}
