import type { ExpenseCategory } from "@prisma/client";
import { withRLS, type RlsContext } from "@/lib/rls";
import { resolvePeriod } from "@/lib/period";
import { prisma } from "@/lib/db";

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
    // 보관(소프트 삭제)된 고객사의 실적·청구·입금·지출은 전사 집계에서 제외한다.
    const perf = await tx.monthlyPerformance.aggregate({
      where: { year, month: monthRange, task: { client: { deletedAt: null } } },
      _sum: { amount: true },
    });
    const billing = await tx.monthlyBilling.aggregate({
      where: { year, month: monthRange, client: { deletedAt: null } },
      _sum: { amount: true },
    });
    const deposit = await tx.monthlyDeposit.aggregate({
      where: { year, month: monthRange, client: { deletedAt: null } },
      _sum: { amount: true },
    });
    const expense = await tx.expense.aggregate({
      where: { year, month: monthRange, client: { deletedAt: null } },
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
    const r = await tx.task.aggregate({ where: { client: { deletedAt: null } }, _sum: { contractAmount: true } });
    return r._sum.contractAmount ?? 0;
  });
}

// 고객사별 진행율 계산용: 해당 연도 누적 실적금액과 전체 계약금액을 고객사별로 반환.
// 진행율 = perf / contract (attainment)로 목록 카드에서 계산한다.
export function getClientYearProgress(
  ctx: RlsContext,
  year: number,
): Promise<{ perf: Map<string, number>; contract: Map<string, number> }> {
  return withRLS(ctx, async (tx) => {
    // 순차 await (같은 tx에서 병렬 쿼리 금지).
    const perfRows = await tx.monthlyPerformance.findMany({
      where: { year, task: { client: { deletedAt: null } } },
      select: { amount: true, task: { select: { clientId: true } } },
    });
    const contractRows = await tx.task.groupBy({
      by: ["clientId"],
      where: { client: { deletedAt: null } },
      _sum: { contractAmount: true },
    });
    const perf = new Map<string, number>();
    for (const r of perfRows) {
      const cid = r.task.clientId;
      perf.set(cid, (perf.get(cid) ?? 0) + r.amount);
    }
    const contract = new Map(contractRows.map((r) => [r.clientId, r._sum.contractAmount ?? 0]));
    return { perf, contract };
  });
}

export type TrendPoint = { month: number; performance: number; expense: number };

export function getMonthlyTrend(ctx: RlsContext, year: number): Promise<TrendPoint[]> {
  return withRLS(ctx, async (tx) => {
    const perf = await tx.monthlyPerformance.groupBy({
      by: ["month"],
      where: { year, task: { client: { deletedAt: null } } },
      _sum: { amount: true },
    });
    const exp = await tx.expense.groupBy({
      by: ["month"],
      where: { year, client: { deletedAt: null } },
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
      where: { year, month: { gte: startMonth, lte: endMonth }, client: { deletedAt: null } },
      _sum: { amount: true },
    });
    return rows.map((r) => ({ category: r.category, amount: r._sum.amount ?? 0 }));
  });
}

export type ClientSummary = {
  id: string;
  name: string;
  pms: { id: string; label: string }[]; // 담당 PM(여러 명)
  pmLabel: string; // 담당 PM 라벨(쉼표 결합), 없으면 "미배정"
  industry: string | null;
  performance: number;
  expense: number;
  contract: number;
};

export async function getClientSummaries(
  ctx: RlsContext,
  year: number,
  period: string,
): Promise<ClientSummary[]> {
  const { startMonth, endMonth } = resolvePeriod(period);
  const monthRange = { gte: startMonth, lte: endMonth };
  const base = await withRLS(ctx, async (tx) => {
    const clients = await tx.client.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, include: { managers: true } });
    const perfRows = await tx.monthlyPerformance.findMany({
      where: { year, month: monthRange },
      select: { amount: true, task: { select: { clientId: true } } },
    });
    const expRows = await tx.expense.groupBy({
      by: ["clientId"],
      where: { year, month: monthRange },
      _sum: { amount: true },
    });
    const contractRows = await tx.task.groupBy({
      by: ["clientId"],
      _sum: { contractAmount: true },
    });
    const perfByClient = new Map<string, number>();
    for (const r of perfRows) {
      const cid = r.task.clientId;
      perfByClient.set(cid, (perfByClient.get(cid) ?? 0) + r.amount);
    }
    const expByClient = new Map(expRows.map((r) => [r.clientId, r._sum.amount ?? 0]));
    const contractByClient = new Map(
      contractRows.map((r) => [r.clientId, r._sum.contractAmount ?? 0]),
    );
    return clients.map((c) => ({
      id: c.id,
      name: c.name,
      pmIds: c.managers.map((m) => m.userId),
      industry: c.industry,
      performance: perfByClient.get(c.id) ?? 0,
      expense: expByClient.get(c.id) ?? 0,
      contract: contractByClient.get(c.id) ?? 0,
    }));
  });

  const pmIds = [...new Set(base.flatMap((c) => c.pmIds))];
  const users = pmIds.length
    ? await prisma.user.findMany({ where: { id: { in: pmIds } } })
    : [];
  const labelById = new Map(users.map((u) => [u.id, u.name ?? u.email]));
  return base.map(({ pmIds, ...c }) => {
    const pms = pmIds
      .map((id) => ({ id, label: labelById.get(id) ?? "(알 수 없음)" }))
      .sort((a, b) => a.label.localeCompare(b.label, "ko"));
    return { ...c, pms, pmLabel: pms.length ? pms.map((p) => p.label).join(", ") : "미배정" };
  });
}

export type PmSummary = {
  pmId: string | null;
  label: string;
  clientCount: number;
  performance: number;
  expense: number;
};

export async function getPmSummaries(
  ctx: RlsContext,
  year: number,
  period: string,
): Promise<PmSummary[]> {
  const clients = await getClientSummaries(ctx, year, period);
  return rollupPmSummaries(clients);
}

/** 이미 조회한 고객사 요약에서 PM별 rollup 계산 (대시보드에서 중복 조회 방지용). */
export function rollupPmSummaries(clients: ClientSummary[]): PmSummary[] {
  const byPm = new Map<string | null, { clientCount: number; performance: number; expense: number }>();
  const labelById = new Map<string | null, string>([[null, "미배정"]]);
  const add = (pmId: string | null, c: ClientSummary) => {
    const cur = byPm.get(pmId) ?? { clientCount: 0, performance: 0, expense: 0 };
    byPm.set(pmId, {
      clientCount: cur.clientCount + 1,
      performance: cur.performance + c.performance,
      expense: cur.expense + c.expense,
    });
  };
  for (const c of clients) {
    // PM이 여러 명이면 각 PM 행에 고객사 실적/지출을 전액 반영(중복 집계).
    if (c.pms.length === 0) {
      add(null, c);
    } else {
      for (const p of c.pms) {
        labelById.set(p.id, p.label);
        add(p.id, c);
      }
    }
  }
  return [...byPm.entries()].map(([pmId, agg]) => ({
    pmId,
    label: labelById.get(pmId) ?? "(알 수 없음)",
    ...agg,
  }));
}

export type TaskMonthAmount = { month: number; amount: number };

export type TaskPerf = {
  id: string;
  name: string;
  monthly: TaskMonthAmount[];
  total: number;
};

export type MonthlyRow = {
  month: number;
  performance: number;
  billing: number;
  deposit: number;
  expense: number;
};

export type ClientDetail = {
  client: { id: string; name: string; status: string };
  contract: number;
  tasks: TaskPerf[];
  monthly: MonthlyRow[];
  expenses: ExpenseSlice[];
};

export function getClientDetail(
  ctx: RlsContext,
  id: string,
  year: number,
  period: string,
): Promise<ClientDetail | null> {
  const { startMonth, endMonth } = resolvePeriod(period);
  const monthRange = { gte: startMonth, lte: endMonth };
  return withRLS(ctx, async (tx) => {
    const client = await tx.client.findUnique({ where: { id } });
    if (!client) return null; // 없거나 RLS로 은닉

    const tasks = await tx.task.findMany({ where: { clientId: id }, orderBy: { name: "asc" } });
    const contract = tasks.reduce((s, t) => s + (t.contractAmount ?? 0), 0);
    const perfRows = await tx.monthlyPerformance.findMany({
      where: { year, month: monthRange, task: { clientId: id } },
      select: { taskId: true, month: true, amount: true },
    });
    const byTaskMonth = new Map<string, Map<number, number>>();
    for (const r of perfRows) {
      const m = byTaskMonth.get(r.taskId) ?? new Map<number, number>();
      m.set(r.month, (m.get(r.month) ?? 0) + r.amount);
      byTaskMonth.set(r.taskId, m);
    }
    const months = Array.from({ length: endMonth - startMonth + 1 }, (_, i) => startMonth + i);
    const taskRows: TaskPerf[] = tasks.map((t) => {
      const mm = byTaskMonth.get(t.id) ?? new Map<number, number>();
      const monthly = months.map((month) => ({ month, amount: mm.get(month) ?? 0 }));
      return { id: t.id, name: t.name, monthly, total: monthly.reduce((s, x) => s + x.amount, 0) };
    });

    const perfM = await tx.monthlyPerformance.groupBy({
      by: ["month"], where: { year, task: { clientId: id } }, _sum: { amount: true },
    });
    const billM = await tx.monthlyBilling.groupBy({
      by: ["month"], where: { year, clientId: id }, _sum: { amount: true },
    });
    const depM = await tx.monthlyDeposit.groupBy({
      by: ["month"], where: { year, clientId: id }, _sum: { amount: true },
    });
    const expM = await tx.expense.groupBy({
      by: ["month"], where: { year, clientId: id }, _sum: { amount: true },
    });
    const expCat = await tx.expense.groupBy({
      by: ["category"], where: { year, month: monthRange, clientId: id }, _sum: { amount: true },
    });
    const expenses: ExpenseSlice[] = expCat.map((r) => ({ category: r.category, amount: r._sum.amount ?? 0 }));
    const map = (rows: { month: number; _sum: { amount: number | null } }[]) =>
      new Map(rows.map((r) => [r.month, r._sum.amount ?? 0]));
    const p = map(perfM), b = map(billM), d = map(depM), e = map(expM);
    const monthly: MonthlyRow[] = Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      return {
        month,
        performance: p.get(month) ?? 0,
        billing: b.get(month) ?? 0,
        deposit: d.get(month) ?? 0,
        expense: e.get(month) ?? 0,
      };
    });

    return { client: { id: client.id, name: client.name, status: client.status }, contract, tasks: taskRows, monthly, expenses };
  });
}
