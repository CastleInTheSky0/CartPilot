import { RefreshCw } from "lucide-react";
import { PLATFORM_LABELS } from "../../shared/platform-labels.ts";
import { eventLabel, HOLD_LABELS, PAYMENT_LABELS, RUN_LABELS } from "./history-presentation.ts";
import { formatMoney, formatTime } from "./task-presentation.ts";
import { useTaskHistory } from "./useTaskHistory.ts";
import styles from "./task-history.module.css";
import tableStyles from "./task-workspace.module.css";

export function TaskHistoryPanel({ taskId }: { taskId: string }) {
  const { history, busy, error, readAt, read } = useTaskHistory(taskId);
  const holds =
    history?.intents.filter(
      (intent) => intent.status === "reserved" || intent.status === "pending",
    ) ?? [];
  return (
    <section className={styles.panel} aria-label="运行与订单历史">
      <div className={styles.heading}>
        <div>
          <h3>运行与订单历史</h3>
          <p>{readAt ? `读取于 ${formatTime(readAt)}` : "正在读取本机记录…"}</p>
        </div>
        <button className="button subtle" disabled={busy} onClick={() => void read()}>
          <RefreshCw size={13} className={busy ? "spin" : undefined} />
          刷新历史
        </button>
      </div>
      {error && (
        <p role="alert" className={styles.warning}>
          {error}
        </p>
      )}
      {history && (
        <>
          <h4>
            已确认订单 <small>{history.orders.length} 笔</small>
          </h4>
          {history.orders.length === 0 ? (
            <p className={styles.empty}>还没有已核对的有效订单。</p>
          ) : (
            <div className={tableStyles.tableScroll}>
              <table className={tableStyles.table} aria-label="已确认订单">
                <thead>
                  <tr>
                    <th>平台 / 订单号</th>
                    <th>件数</th>
                    <th>含运费金额</th>
                    <th>支付状态</th>
                    <th>确认时间</th>
                  </tr>
                </thead>
                <tbody>
                  {history.orders.map((order) => (
                    <tr key={order.id}>
                      <td>
                        {PLATFORM_LABELS[order.platform]}
                        <small className={styles.identifier}>{order.orderNumber}</small>
                      </td>
                      <td>{order.quantity} 件</td>
                      <td>{formatMoney(order.amountCents)}</td>
                      <td>{PAYMENT_LABELS[order.paymentStatus]}</td>
                      <td>{formatTime(order.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className={styles.hint}>
            支付状态为本机保存的记录。订单取消、关闭或支付超时仍保留数量与预算进度。
          </p>
          <h4>
            待核对与预留 <small>{holds.length} 笔</small>
          </h4>
          {holds.length === 0 ? (
            <p className={styles.empty}>没有待核对提交或执行预留。</p>
          ) : (
            <>
              <p className={styles.warning}>
                这些记录继续占用数量与预算。未知提交需要核对平台订单，不能直接重试。
              </p>
              <div className={tableStyles.tableScroll}>
                <table className={tableStyles.table} aria-label="待核对与预留">
                  <thead>
                    <tr>
                      <th>平台 / 记录</th>
                      <th>状态</th>
                      <th>占用件数</th>
                      <th>占用金额</th>
                      <th>更新时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {holds.map((intent) => (
                      <tr key={intent.id}>
                        <td>
                          {PLATFORM_LABELS[intent.platform]}
                          <small className={styles.identifier} title={intent.id}>
                            {intent.id.slice(0, 8)}
                          </small>
                        </td>
                        <td>{HOLD_LABELS[intent.status]}</td>
                        <td>{intent.quantity} 件</td>
                        <td>{formatMoney(intent.amountCents)}</td>
                        <td>{formatTime(intent.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <details className={styles.details}>
            <summary>运行记录 · {history.runs.length} 次</summary>
            {history.runs.length === 0 ? (
              <p className={styles.empty}>任务尚未运行。</p>
            ) : (
              <div className={tableStyles.tableScroll}>
                <table className={tableStyles.table} aria-label="运行记录">
                  <thead>
                    <tr>
                      <th>运行</th>
                      <th>状态</th>
                      <th>开始时间</th>
                      <th>结束时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.runs.map((run) => (
                      <tr key={run.id}>
                        <td title={run.id}>{run.id.slice(0, 8)}</td>
                        <td>{RUN_LABELS[run.status]}</td>
                        <td>{formatTime(run.createdAt)}</td>
                        <td>{run.endedAt ? formatTime(run.endedAt) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </details>
          <details className={styles.details}>
            <summary>事件记录 · 已加载 {history.events.length} 条</summary>
            <ol className={styles.events}>
              {history.events.map((event) => (
                <li key={event.sequence}>
                  <time dateTime={event.at}>{formatTime(event.at)}</time>
                  <div>
                    <p>{eventLabel(event.type)}</p>
                    {event.reason && <p className={styles.reason}>{event.reason}</p>}
                    {event.intentId && (
                      <small title={event.intentId}>关联记录 {event.intentId.slice(0, 8)}</small>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            {history.nextBeforeSequence !== null && (
              <button
                className="button"
                disabled={busy}
                onClick={() => void read(history.nextBeforeSequence ?? undefined)}
              >
                加载更早记录
              </button>
            )}
          </details>
        </>
      )}
    </section>
  );
}
