import type { ExpenseCategory } from "@prisma/client";
import { withRLS, type RlsContext } from "@/lib/rls";
import type { ActionState } from "@/lib/action-state";

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
