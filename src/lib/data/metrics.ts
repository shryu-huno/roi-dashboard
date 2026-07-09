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
