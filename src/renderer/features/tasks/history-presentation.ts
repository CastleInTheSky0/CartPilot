import type { PaymentStatus } from "../../../shared/contracts/purchase-order.ts";

export const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  unpaid: "待支付",
  paid: "已支付",
  cancelled: "已取消",
  closed: "已关闭",
  expired: "支付超时",
};

export const RUN_LABELS = { active: "运行中", stopped: "已停止", interrupted: "中断，待复核" };
export const HOLD_LABELS = {
  reserved: "执行预留",
  pending: "提交待核对",
  confirmed: "已确认订单",
  released: "已释放",
};

const EVENT_LABELS: Record<string, string> = {
  task_created: "已创建任务",
  run_started: "已启动本次运行",
  run_stopped: "已停止本次运行",
  run_interrupted: "检测到上次运行中断，需要复核",
  purchase_reserved: "已预留数量与预算",
  reservation_released: "已释放未进入提交阶段的预留",
  submission_authorized: "已登记提交授权，结果待核对",
  order_confirmed: "已核对有效订单，计入任务进度",
  no_order_verified: "已核对未生成订单，释放占用",
  payment_status_changed: "已更新支付状态，保留任务进度",
  legacy_imported: "已导入旧数据并保留备份",
  restriction_reviewed: "已记录访问冷却后的人工核对",
};

export function eventLabel(type: string): string {
  return EVENT_LABELS[type] ?? "其他任务记录";
}
