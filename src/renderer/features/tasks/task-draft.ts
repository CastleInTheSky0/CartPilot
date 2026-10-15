import { z } from "zod";
import type { Platform } from "../../../shared/contracts/browser.ts";
import {
  PurchaseTaskDefinitionSchema,
  type PurchaseTaskDefinition,
} from "../../../shared/contracts/purchase-task.ts";

export interface CandidateDraft {
  id: string;
  platform: Platform;
  productUrl: string;
  productId: string;
  skuId: string;
  expectedSeller: string;
  launchAt: string;
}

export interface TaskDraft {
  name: string;
  productName: string;
  specifications: { id: string; name: string; value: string }[];
  candidates: CandidateDraft[];
  quantityMode: "total" | "per_platform";
  targetQuantity: string;
  platformTargets: Record<Platform, string>;
  orderQuantity: string;
  allowPartial: boolean;
  maxUnitPrice: string;
  totalBudget: string;
  submissionMode: "" | "automatic" | "manual";
  launchAt: string;
  maxRunMinutes: string;
}

export function newCandidate(): CandidateDraft {
  return {
    id: crypto.randomUUID(),
    platform: "jd",
    productUrl: "",
    productId: "",
    skuId: "",
    expectedSeller: "",
    launchAt: "",
  };
}

export function newTaskDraft(): TaskDraft {
  return {
    name: "",
    productName: "",
    specifications: [],
    candidates: [newCandidate()],
    quantityMode: "total",
    targetQuantity: "1",
    platformTargets: { apple: "1", taobao: "1", tmall: "1", jd: "1", douyin: "1" },
    orderQuantity: "1",
    allowPartial: false,
    maxUnitPrice: "",
    totalBudget: "",
    submissionMode: "",
    launchAt: "",
    maxRunMinutes: "10",
  };
}

function integer(value: string, label: string): number {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new Error(`${label}请填写整数。`);
  return Number(value);
}

export function yuanToCents(value: string, label: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error(`${label}最多保留两位小数。`);
  const [whole, fraction = ""] = value.split(".");
  const cents = Number(whole + fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new Error(`${label}超出精确金额范围。`);
  return cents;
}

function timestamp(value: string, label: string): string {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) throw new Error(`请填写${label}。`);
  return date.toISOString();
}

const FIELD_LABELS: Record<string, string> = {
  name: "任务名称",
  product: "商品与规格",
  candidates: "候选商品",
  quantityPlan: "目标数量",
  orderQuantity: "单笔数量",
  budget: "预算",
  submissionMode: "提交方式",
  schedule: "开售时间与运行时限",
};

export function taskFormError(error: unknown): string {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    const label = FIELD_LABELS[String(issue?.path[0])] ?? "任务内容";
    return issue?.code === "custom" ? `${label}：${issue.message}` : `请检查${label}。`;
  }
  return error instanceof Error ? error.message : "无法保存任务，请重试。";
}

export function taskDefinition(draft: TaskDraft): PurchaseTaskDefinition {
  if (!draft.submissionMode) throw new Error("请选择提交方式。支付需要你自行完成。");
  const specifications: Record<string, string> = {};
  for (const row of draft.specifications) {
    const name = row.name.trim();
    if (Object.hasOwn(specifications, name)) throw new Error("规格名称不能重复。");
    Object.defineProperty(specifications, name, {
      value: row.value.trim(),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  const platforms = [...new Set(draft.candidates.map((candidate) => candidate.platform))];
  return PurchaseTaskDefinitionSchema.parse({
    version: 1,
    name: draft.name,
    product: { name: draft.productName, specifications },
    candidates: draft.candidates.map((candidate) => ({
      id: candidate.id,
      platform: candidate.platform,
      productUrl: candidate.productUrl.trim(),
      productId: candidate.productId.trim() || null,
      skuId: candidate.skuId.trim() || null,
      expectedSeller: candidate.expectedSeller.trim() || null,
      ...(candidate.launchAt ? { launchAt: timestamp(candidate.launchAt, "候选开售时间") } : {}),
    })),
    quantityPlan:
      draft.quantityMode === "total"
        ? { mode: "total", targetQuantity: integer(draft.targetQuantity, "目标数量") }
        : {
            mode: "per_platform",
            targets: platforms.map((platform) => ({
              platform,
              quantity: integer(draft.platformTargets[platform], "平台目标数量"),
            })),
          },
    orderQuantity: integer(draft.orderQuantity, "单笔数量"),
    allowPartial: draft.allowPartial,
    budget: {
      currency: "CNY",
      maxUnitPriceCents: yuanToCents(draft.maxUnitPrice, "每件最高价"),
      totalBudgetCents: yuanToCents(draft.totalBudget, "任务总预算"),
    },
    submissionMode: draft.submissionMode,
    schedule: {
      launchAt: timestamp(draft.launchAt, "开售时间"),
      maxRunMinutes: integer(draft.maxRunMinutes, "最长运行时间"),
    },
  });
}
