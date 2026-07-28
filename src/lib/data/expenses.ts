import type { ExpenseCategory } from "@prisma/client";
import { withRLS, type RlsContext } from "@/lib/rls";
import type { ActionState } from "@/lib/action-state";
import {
  EXPENSE_SUMMARY_CATEGORIES,
  type ExpenseSummaryKey,
} from "@/lib/expense-summary";
import type { Ym } from "@/lib/month-range";

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
