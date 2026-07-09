import type { ExpenseCategory } from "@prisma/client";
import { withRLS, type RlsContext } from "@/lib/rls";
import { resolvePeriod } from "@/lib/period";

export type PeriodTotals = {
  performance: number;
  billing: number;
  deposit: number;
  expense: number;
};

export function getPeriodTotals(
  ctx: RlsContext,
  year: number,
  period: string,
): Promise<PeriodTotals> {
  const { startMonth, endMonth } = resolvePeriod(period);
  const monthRange = { gte: startMonth, lte: endMonth };
  return withRLS(ctx, async (tx) => {
    // 순차 await (같은 tx에서 병렬 쿼리 금지).
    const perf = await tx.monthlyPerformance.aggregate({
      where: { year, month: monthRange },
      _sum: { amount: true },
    });
    const billing = await tx.monthlyBilling.aggregate({
      where: { year, month: monthRange },
      _sum: { amount: true },
    });
    const deposit = await tx.monthlyDeposit.aggregate({
      where: { year, month: monthRange },
      _sum: { amount: true },
    });
    const expense = await tx.expense.aggregate({
      where: { year, month: monthRange },
      _sum: { amount: true },
    });
    return {
      performance: perf._sum.amount ?? 0,
      billing: billing._sum.amount ?? 0,
      deposit: deposit._sum.amount ?? 0,
      expense: expense._sum.amount ?? 0,
    };
  });
}

export function getContractTotal(ctx: RlsContext): Promise<number> {
  return withRLS(ctx, async (tx) => {
    const r = await tx.task.aggregate({ _sum: { contractAmount: true } });
    return r._sum.contractAmount ?? 0;
  });
}

export type TrendPoint = { month: number; performance: number; expense: number };

export function getMonthlyTrend(ctx: RlsContext, year: number): Promise<TrendPoint[]> {
  return withRLS(ctx, async (tx) => {
    const perf = await tx.monthlyPerformance.groupBy({
      by: ["month"],
      where: { year },
      _sum: { amount: true },
    });
    const exp = await tx.expense.groupBy({
      by: ["month"],
      where: { year },
      _sum: { amount: true },
    });
    const perfByMonth = new Map(perf.map((r) => [r.month, r._sum.amount ?? 0]));
    const expByMonth = new Map(exp.map((r) => [r.month, r._sum.amount ?? 0]));
    return Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      return {
        month,
        performance: perfByMonth.get(month) ?? 0,
        expense: expByMonth.get(month) ?? 0,
      };
    });
  });
}

export type ExpenseSlice = { category: ExpenseCategory; amount: number };

export function getExpenseBreakdown(
  ctx: RlsContext,
  year: number,
  period: string,
): Promise<ExpenseSlice[]> {
  const { startMonth, endMonth } = resolvePeriod(period);
  return withRLS(ctx, async (tx) => {
    const rows = await tx.expense.groupBy({
      by: ["category"],
      where: { year, month: { gte: startMonth, lte: endMonth } },
      _sum: { amount: true },
    });
    return rows.map((r) => ({ category: r.category, amount: r._sum.amount ?? 0 }));
  });
}
