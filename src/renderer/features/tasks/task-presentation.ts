import type { TaskOverview } from "../../../shared/contracts/task-workspace.ts";

const currency = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  minimumFractionDigits: 2,
});
const dateTime = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export const formatMoney = (cents: number): string => currency.format(cents / 100);
export const formatTime = (timestamp: string): string => dateTime.format(new Date(timestamp));

export function taskStatus({ progress }: TaskOverview) {
  if (progress.byPlatform.some((item) => item.pendingQuantity > 0))
    return { label: "提交待核对", tone: "warning" };
  if (progress.isComplete) return { label: "目标完成", tone: "complete" };
  if (progress.byPlatform.some((item) => item.reservedQuantity > 0))
    return { label: "有执行预留", tone: "warning" };
  return { label: "待复核", tone: "muted" };
}
