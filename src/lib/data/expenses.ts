import type { ExpenseCategory } from "@prisma/client";
import { withRLS, type RlsContext } from "@/lib/rls";
import type { ActionState } from "@/lib/action-state";
import {
  EXPENSE_SUMMARY_CATEGORIES,
  type ExpenseSummaryKey,
} from "@/lib/expense-summary";
import { eachMonth, type Ym } from "@/lib/month-range";

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

// 전체 내역 요약표용 분류별 합계. 항목별 지출 라인아이템 모델이 도입되면
// 여기서 clientId·[from~to] 기간·분류 기준으로 합산한다. 지금은 라인아이템 데이터가
// 없으므로 모든 분류를 0으로 반환한다(연동 지점 단일화).
export async function getExpenseSummaryTotals(
  _ctx: RlsContext,
  _clientId: string,
  _from: Ym,
  _to: Ym,
): Promise<Record<ExpenseSummaryKey, number>> {
  // TODO: 라인아이템(지출 항목) 모델 연동 시 [from~to] 각 달을 합산하도록 교체.
  return Object.fromEntries(
    EXPENSE_SUMMARY_CATEGORIES.map((c) => [c.key, 0]),
  ) as Record<ExpenseSummaryKey, number>;
}

// 상담비 상세 원장(ConsultingExpense)을 상담분야(field)별로 합산.
// clientId를 주면 해당 고객사만, 없으면 RLS 범위 전체(관리자·정산=모든 고객사, PM=담당 고객사).
// 기간은 [from~to]의 각 (year,month)로 필터한다.
export type ConsultingFieldRow = { field: string; count: number; amount: number };

export async function getConsultingFieldSummary(
  ctx: RlsContext,
  opts: { clientId?: string; from: Ym; to: Ym },
): Promise<{ rows: ConsultingFieldRow[]; total: number; totalCount: number }> {
  const months = eachMonth(opts.from, opts.to);
  const where = {
    ...(opts.clientId ? { clientId: opts.clientId } : {}),
    OR: months.map((m) => ({ year: m.year, month: m.month })),
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
