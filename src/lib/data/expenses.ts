import type { ExpenseCategory } from "@prisma/client";
import { withRLS, type RlsContext } from "@/lib/rls";
import type { ActionState } from "@/lib/action-state";
import {
  EXPENSE_SUMMARY_CATEGORIES,
  type ExpenseSummaryKey,
} from "@/lib/expense-summary";
import { eachMonth, type Ym } from "@/lib/month-range";
import { sessionDateBetween } from "@/lib/consulting-basis";

export type ExpenseInput = {
  clientId: string;
  year: number;
  month: number;
  category: ExpenseCategory;
  amount: number;
  memo?: string | null;
};

export function listExpenses(ctx: RlsContext, clientId: string, year: number, month: number) {
  return withRLS(ctx, (tx) => tx.expense.findMany({ where: { clientId, year, month } }));
}

// 전체 내역 요약표용 분류별 합계. clientId·[from~to] 기간 기준으로 합산한다.
// 상담비(ConsultingExpense)·법인카드(CorporateCardExpense)는 상세 원장에서 실제 합산하고,
// 나머지 분류(지급 내역·개인카드·홍보비·하이패스)는 아직 전용 모델이 없어 0으로 둔다.
// 금액은 원장 원값(부가세 미포함) — 같은 화면의 상담비/법인카드 탭과 동일 기준.
// fiscalBasis: false=프로젝트 기준(상담비 실시일시), true=회계연도 기준(상담비 지급월).
export async function getExpenseSummaryTotals(
  ctx: RlsContext,
  clientId: string,
  from: Ym,
  to: Ym,
  fiscalBasis = false,
): Promise<Record<ExpenseSummaryKey, number>> {
  const [consulting, corporate] = await Promise.all([
    getConsultingFieldSummary(ctx, { clientId, from, to, fiscalBasis }),
    getCorporateCardSummary(ctx, { clientId, from, to }),
  ]);
  // TODO: 지급 내역·개인카드·홍보비·하이패스는 데이터 모델 도입 시 여기에 합산 추가.
  const totals = Object.fromEntries(
    EXPENSE_SUMMARY_CATEGORIES.map((c) => [c.key, 0]),
  ) as Record<ExpenseSummaryKey, number>;
  totals.consulting = consulting.total;
  totals["corporate-card"] = corporate.total;
  return totals;
}

// 상담비 상세 원장(ConsultingExpense)을 상담분야(field)별로 합산.
// clientId를 주면 해당 고객사만, 없으면 RLS 범위 전체(관리자·정산=모든 고객사, PM=담당 고객사).
// 기간은 [from~to]의 각 (year,month)로 필터한다.
export type ConsultingFieldRow = { field: string; count: number; amount: number };

// fiscalBasis: false=프로젝트 기준(실시일시로 기간 필터), true=회계연도 기준(지급월로 필터).
export async function getConsultingFieldSummary(
  ctx: RlsContext,
  opts: { clientId?: string; from: Ym; to: Ym; fiscalBasis?: boolean },
): Promise<{ rows: ConsultingFieldRow[]; total: number; totalCount: number }> {
  const months = eachMonth(opts.from, opts.to);
  const where = {
    ...(opts.clientId ? { clientId: opts.clientId } : {}),
    ...(opts.fiscalBasis
      ? { OR: months.map((m) => ({ year: m.year, month: m.month })) }
      : { sessionDate: sessionDateBetween(opts.from, opts.to) }),
  };
  const grouped = await withRLS(ctx, (tx) =>
    tx.consultingExpense.groupBy({
      by: ["field"],
      where,
      _sum: { amount: true },
      _count: true,
    }),
  );
  const rows = grouped
    .map((g) => ({ field: g.field, count: g._count, amount: g._sum.amount ?? 0 }))
    .sort((a, b) => b.amount - a.amount || b.count - a.count);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const totalCount = rows.reduce((s, r) => s + r.count, 0);
  return { rows, total, totalCount };
}

// 법인카드 상세 원장(CorporateCardExpense)을 항목(item)별로 합산.
// clientId를 주면 해당 고객사만, 없으면 RLS 범위 전체(관리자·정산=모든 고객사, PM=담당 고객사).
// 기간은 [from~to]의 각 (year,month)로 필터한다. 상담비와 달리 건수 없이 금액만 집계한다.
export type CorporateCardItemRow = { item: string; amount: number };

export async function getCorporateCardSummary(
  ctx: RlsContext,
  opts: { clientId?: string; from: Ym; to: Ym },
): Promise<{ rows: CorporateCardItemRow[]; total: number }> {
  const months = eachMonth(opts.from, opts.to);
  const where = {
    ...(opts.clientId ? { clientId: opts.clientId } : {}),
    OR: months.map((m) => ({ year: m.year, month: m.month })),
  };
  const grouped = await withRLS(ctx, (tx) =>
    tx.corporateCardExpense.groupBy({
      by: ["item"],
      where,
      _sum: { amount: true },
    }),
  );
  const rows = grouped
    .map((g) => ({ item: g.item, amount: g._sum.amount ?? 0 }))
    .sort((a, b) => b.amount - a.amount);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return { rows, total };
}

export async function upsertExpense(ctx: RlsContext, input: ExpenseInput): Promise<ActionState> {
  await withRLS(ctx, (tx) =>
    tx.expense.upsert({
      where: {
        clientId_year_month_category: {
          clientId: input.clientId,
          year: input.year,
          month: input.month,
          category: input.category,
        },
      },
      create: {
        clientId: input.clientId,
        year: input.year,
        month: input.month,
        category: input.category,
        amount: input.amount,
        memo: input.memo ?? null,
      },
      update: { amount: input.amount, memo: input.memo ?? null },
    }),
  );
  return { ok: true };
}
