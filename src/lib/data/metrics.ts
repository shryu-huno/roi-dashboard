import type { ExpenseCategory } from "@prisma/client";
import { withRLS, type RlsContext } from "@/lib/rls";
import { resolvePeriod } from "@/lib/period";
import { prisma } from "@/lib/db";
import { withVat, withVatSplit } from "@/lib/vat";
import { sessionDateBetween, sessionMonth } from "@/lib/consulting-basis";
import { eachMonth, orderRange, type Ym } from "@/lib/month-range";
import { deriveProjectName } from "@/lib/clients/summary-view";

// 고객사 where 조각: 보관(소프트 삭제) 제외 + (옵션) 현대이지웰 고객사만.
function clientWhere(easywelOnly: boolean) {
  return { deletedAt: null, ...(easywelOnly ? { hyundaiEasywel: true } : {}) };
}

export type PeriodTotals = {
  performance: number;
  billing: number;
  deposit: number;
  expense: number;
};

// fiscalBasis: false=프로젝트 기준(상담비를 실시일시로 집계), true=회계연도 기준(지급월로 집계).
export function getPeriodTotals(
  ctx: RlsContext,
  year: number,
  period: string,
  includeVat = false,
  easywelOnly = false,
  fiscalBasis = false,
): Promise<PeriodTotals> {
  const { startMonth, endMonth } = resolvePeriod(period);
  const monthRange = { gte: startMonth, lte: endMonth };
  const cw = clientWhere(easywelOnly);
  return withRLS(ctx, async (tx) => {
    // 순차 await (같은 tx에서 병렬 쿼리 금지).
    // 보관(소프트 삭제)된 고객사의 실적·청구·입금·지출은 전사 집계에서 제외한다.
    // 실적은 면세/과세를 나눠 집계해, 과세분에만 부가세를 적용한다(면세 과업은 토글 무시).
    const perfTaxable = await tx.monthlyPerformance.aggregate({
      where: { year, month: monthRange, task: { client: cw, vatExempt: false } },
      _sum: { amount: true },
    });
    const perfExempt = await tx.monthlyPerformance.aggregate({
      where: { year, month: monthRange, task: { client: cw, vatExempt: true } },
      _sum: { amount: true },
    });
    const billing = await tx.monthlyBilling.aggregate({
      where: { year, month: monthRange, client: cw },
      _sum: { amount: true },
    });
    const deposit = await tx.monthlyDeposit.aggregate({
      where: { year, month: monthRange, client: cw },
      _sum: { amount: true },
    });
    // 지출 = Expense(법인/개인카드·홍보비 등 카테고리) + ConsultingExpense(상담비) + CorporateCardExpense(법인카드).
    // 다른 지출원(지급요청·하이패스 등)은 데이터 모델이 생기면 여기에 더한다.
    const expense = await tx.expense.aggregate({
      where: { year, month: monthRange, client: cw },
      _sum: { amount: true },
    });
    const consulting = await tx.consultingExpense.aggregate({
      where: fiscalBasis
        ? { year, month: monthRange, client: cw }
        : { sessionDate: sessionDateBetween({ year, month: startMonth }, { year, month: endMonth }), client: cw },
      _sum: { amount: true },
    });
    const corporateCard = await tx.corporateCardExpense.aggregate({
      where: { year, month: monthRange, client: cw },
      _sum: { amount: true },
    });
    const expenseTotal =
      (expense._sum.amount ?? 0) + (consulting._sum.amount ?? 0) + (corporateCard._sum.amount ?? 0);
    return {
      performance: withVatSplit(perfTaxable._sum.amount ?? 0, perfExempt._sum.amount ?? 0, includeVat),
      billing: withVat(billing._sum.amount ?? 0, includeVat),
      deposit: withVat(deposit._sum.amount ?? 0, includeVat),
      // 지출은 부가세 미포함(원장 원값). 실적/청구/입금만 VAT 토글을 따른다.
      expense: expenseTotal,
    };
  });
}

export function getContractTotal(ctx: RlsContext, includeVat = false, easywelOnly = false): Promise<number> {
  return withRLS(ctx, async (tx) => {
    // 전체 프로젝트가 아니라 고객사마다 "가장 최근 프로젝트"(계약 시작일이 가장 늦은 것,
    // 시작일이 없으면 등록일 최신) 1건의 계약금만 합산한다.
    const projects = await tx.project.findMany({
      where: { deletedAt: null, client: clientWhere(easywelOnly) },
      orderBy: [{ contractStart: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      select: { clientId: true, tasks: { select: { contractAmount: true, vatExempt: true } } },
    });
    const seen = new Set<string>();
    let taxable = 0;
    let exempt = 0;
    for (const p of projects) {
      if (seen.has(p.clientId)) continue; // 고객사별 첫 행 = 가장 최근 프로젝트
      seen.add(p.clientId);
      for (const t of p.tasks) {
        const amt = t.contractAmount ?? 0;
        if (t.vatExempt) exempt += amt;
        else taxable += amt;
      }
    }
    return withVatSplit(taxable, exempt, includeVat);
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

export function getMonthlyTrend(ctx: RlsContext, year: number, includeVat = false, easywelOnly = false, fiscalBasis = false): Promise<TrendPoint[]> {
  const cw = clientWhere(easywelOnly);
  return withRLS(ctx, async (tx) => {
    // 실적은 면세/과세를 나눠 집계(과세분만 부가세 적용).
    const perfTaxable = await tx.monthlyPerformance.groupBy({
      by: ["month"],
      where: { year, task: { client: cw, vatExempt: false } },
      _sum: { amount: true },
    });
    const perfExempt = await tx.monthlyPerformance.groupBy({
      by: ["month"],
      where: { year, task: { client: cw, vatExempt: true } },
      _sum: { amount: true },
    });
    const exp = await tx.expense.groupBy({
      by: ["month"],
      where: { year, client: cw },
      _sum: { amount: true },
    });
    // 상담비 월별 — 회계연도 기준은 지급월(groupBy), 프로젝트 기준은 실시일시에서 월 추출(JS 집계).
    const consByMonth = new Map<number, number>();
    if (fiscalBasis) {
      const cons = await tx.consultingExpense.groupBy({
        by: ["month"],
        where: { year, client: cw },
        _sum: { amount: true },
      });
      for (const r of cons) consByMonth.set(r.month, r._sum.amount ?? 0);
    } else {
      const consRows = await tx.consultingExpense.findMany({
        where: { sessionDate: sessionDateBetween({ year, month: 1 }, { year, month: 12 }), client: cw },
        select: { sessionDate: true, amount: true },
      });
      for (const r of consRows) {
        if (!r.sessionDate) continue;
        const m = sessionMonth(r.sessionDate);
        consByMonth.set(m, (consByMonth.get(m) ?? 0) + (r.amount ?? 0));
      }
    }
    const cc = await tx.corporateCardExpense.groupBy({
      by: ["month"],
      where: { year, client: cw },
      _sum: { amount: true },
    });
    const perfTaxByMonth = new Map(perfTaxable.map((r) => [r.month, r._sum.amount ?? 0]));
    const perfExByMonth = new Map(perfExempt.map((r) => [r.month, r._sum.amount ?? 0]));
    const expByMonth = new Map(exp.map((r) => [r.month, r._sum.amount ?? 0]));
    const ccByMonth = new Map(cc.map((r) => [r.month, r._sum.amount ?? 0]));
    return Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      return {
        month,
        performance: withVatSplit(perfTaxByMonth.get(month) ?? 0, perfExByMonth.get(month) ?? 0, includeVat),
        // 지출은 부가세 미포함(원장 원값).
        expense: (expByMonth.get(month) ?? 0) + (consByMonth.get(month) ?? 0) + (ccByMonth.get(month) ?? 0),
      };
    });
  });
}

export type ExpenseSlice = { category: ExpenseCategory; amount: number };

// 지출 분류별 내역 — 부가세 미포함(원장 원값)이라 includeVat 파라미터가 없다.
export function getExpenseBreakdown(
  ctx: RlsContext,
  year: number,
  period: string,
  easywelOnly = false,
): Promise<ExpenseSlice[]> {
  const { startMonth, endMonth } = resolvePeriod(period);
  return withRLS(ctx, async (tx) => {
    const rows = await tx.expense.groupBy({
      by: ["category"],
      where: { year, month: { gte: startMonth, lte: endMonth }, client: clientWhere(easywelOnly) },
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
  includeVat = false,
  easywelOnly = false,
  fiscalBasis = false,
): Promise<ClientSummary[]> {
  const { startMonth, endMonth } = resolvePeriod(period);
  const monthRange = { gte: startMonth, lte: endMonth };
  const base = await withRLS(ctx, async (tx) => {
    const clients = await tx.client.findMany({ where: clientWhere(easywelOnly), orderBy: { name: "asc" }, include: { managers: true } });
    const perfRows = await tx.monthlyPerformance.findMany({
      where: { year, month: monthRange },
      select: { amount: true, task: { select: { clientId: true, vatExempt: true } } },
    });
    const expRows = await tx.expense.groupBy({
      by: ["clientId"],
      where: { year, month: monthRange },
      _sum: { amount: true },
    });
    const consRows = await tx.consultingExpense.groupBy({
      by: ["clientId"],
      where: fiscalBasis
        ? { year, month: monthRange }
        : { sessionDate: sessionDateBetween({ year, month: startMonth }, { year, month: endMonth }) },
      _sum: { amount: true },
    });
    const ccRows = await tx.corporateCardExpense.groupBy({
      by: ["clientId"],
      where: { year, month: monthRange },
      _sum: { amount: true },
    });
    const contractRows = await tx.task.groupBy({
      by: ["clientId", "vatExempt"],
      _sum: { contractAmount: true },
    });
    // 실적·계약금 모두 고객사별로 면세/과세를 나눠 둔다(과세분만 부가세 적용).
    const perfTaxable = new Map<string, number>();
    const perfExempt = new Map<string, number>();
    for (const r of perfRows) {
      const cid = r.task.clientId;
      const m = r.task.vatExempt ? perfExempt : perfTaxable;
      m.set(cid, (m.get(cid) ?? 0) + r.amount);
    }
    // 고객사별 지출 = Expense + ConsultingExpense(상담비) + CorporateCardExpense(법인카드).
    const expByClient = new Map<string, number>();
    for (const r of expRows) expByClient.set(r.clientId, (expByClient.get(r.clientId) ?? 0) + (r._sum.amount ?? 0));
    for (const r of consRows) expByClient.set(r.clientId, (expByClient.get(r.clientId) ?? 0) + (r._sum.amount ?? 0));
    for (const r of ccRows) expByClient.set(r.clientId, (expByClient.get(r.clientId) ?? 0) + (r._sum.amount ?? 0));
    const contractTaxable = new Map<string, number>();
    const contractExempt = new Map<string, number>();
    for (const r of contractRows) {
      const m = r.vatExempt ? contractExempt : contractTaxable;
      m.set(r.clientId, (m.get(r.clientId) ?? 0) + (r._sum.contractAmount ?? 0));
    }
    return clients.map((c) => ({
      id: c.id,
      name: c.name,
      pmIds: c.managers.map((m) => m.userId),
      industry: c.industry,
      performance: withVatSplit(perfTaxable.get(c.id) ?? 0, perfExempt.get(c.id) ?? 0, includeVat),
      // 지출은 부가세 미포함(원장 원값).
      expense: expByClient.get(c.id) ?? 0,
      contract: withVatSplit(contractTaxable.get(c.id) ?? 0, contractExempt.get(c.id) ?? 0, includeVat),
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
  fiscalBasis = false,
): Promise<PmSummary[]> {
  const clients = await getClientSummaries(ctx, year, period, false, false, fiscalBasis);
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

export type TaskMonthAmount = { month: number; amount: number; count: number | null };

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
  includeVat = false,
  fiscalBasis = false,
  projectId?: string,
): Promise<ClientDetail | null> {
  const { startMonth, endMonth } = resolvePeriod(period);
  const monthRange = { gte: startMonth, lte: endMonth };
  return withRLS(ctx, async (tx) => {
    const client = await tx.client.findUnique({ where: { id } });
    if (!client) return null; // 없거나 RLS로 은닉

    // 프로젝트 스코프: projectId가 주어지면 과업·실적을 해당 프로젝트로 한정하고,
    // 고객사 단위로만 저장되는 청구·입금·지출은 프로젝트 계약기간 창으로 귀속한다.
    const project = projectId ? await tx.project.findUnique({ where: { id: projectId } }) : null;
    if (projectId && (!project || project.clientId !== id)) return null;
    const taskWhere = projectId ? { clientId: id, projectId } : { clientId: id };
    // 청구·입금·지출을 귀속할 월 집합(선택 연도 내).
    const windowMonths = projectWindowMonths(year, project, fiscalBasis);

    const tasks = await tx.task.findMany({ where: taskWhere, orderBy: { name: "asc" } });
    // 면세 과업 계약금은 부가세 토글과 무관하게 원값 유지.
    const contractTaxable = tasks.reduce((s, t) => s + (t.vatExempt ? 0 : t.contractAmount ?? 0), 0);
    const contractExempt = tasks.reduce((s, t) => s + (t.vatExempt ? t.contractAmount ?? 0 : 0), 0);
    const contract = withVatSplit(contractTaxable, contractExempt, includeVat);
    const perfRows = await tx.monthlyPerformance.findMany({
      where: { year, month: monthRange, task: taskWhere },
      select: { taskId: true, month: true, amount: true, count: true },
    });
    // @@unique([taskId, year, month])로 셀당 행이 유일하므로 합산 없이 그대로 매핑한다.
    const byTaskMonth = new Map<string, Map<number, { amount: number; count: number | null }>>();
    for (const r of perfRows) {
      const m = byTaskMonth.get(r.taskId) ?? new Map<number, { amount: number; count: number | null }>();
      m.set(r.month, { amount: r.amount, count: r.count });
      byTaskMonth.set(r.taskId, m);
    }
    const months = Array.from({ length: endMonth - startMonth + 1 }, (_, i) => startMonth + i);
    const taskRows: TaskPerf[] = tasks.map((t) => {
      const mm = byTaskMonth.get(t.id) ?? new Map<number, { amount: number; count: number | null }>();
      // 면세 과업은 실적에도 부가세를 적용하지 않는다.
      const monthly = months.map((month) => {
        const rec = mm.get(month);
        const raw = rec?.amount ?? 0;
        return { month, amount: t.vatExempt ? raw : withVat(raw, includeVat), count: rec?.count ?? null };
      });
      return { id: t.id, name: t.name, monthly, total: monthly.reduce((s, x) => s + x.amount, 0) };
    });

    // 월별 실적 합계도 면세/과세를 나눠 집계(과세분만 부가세 적용).
    const perfMTaxable = await tx.monthlyPerformance.groupBy({
      by: ["month"], where: { year, task: { ...taskWhere, vatExempt: false } }, _sum: { amount: true },
    });
    const perfMExempt = await tx.monthlyPerformance.groupBy({
      by: ["month"], where: { year, task: { ...taskWhere, vatExempt: true } }, _sum: { amount: true },
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
    // 상담비 월별 — 회계연도 기준은 지급월(groupBy), 프로젝트 기준은 실시일시에서 월 추출(JS 집계).
    const ce = new Map<number, number>();
    if (fiscalBasis) {
      const consM = await tx.consultingExpense.groupBy({
        by: ["month"], where: { year, clientId: id }, _sum: { amount: true },
      });
      for (const r of consM) ce.set(r.month, r._sum.amount ?? 0);
    } else {
      const consRows = await tx.consultingExpense.findMany({
        where: { sessionDate: sessionDateBetween({ year, month: 1 }, { year, month: 12 }), clientId: id },
        select: { sessionDate: true, amount: true },
      });
      for (const r of consRows) {
        if (!r.sessionDate) continue;
        const m = sessionMonth(r.sessionDate);
        ce.set(m, (ce.get(m) ?? 0) + (r.amount ?? 0));
      }
    }
    const ccM = await tx.corporateCardExpense.groupBy({
      by: ["month"], where: { year, clientId: id }, _sum: { amount: true },
    });
    // 지출 구성(도넛)도 프로젝트 계약기간 창 ∩ 선택 구간으로 한정.
    const expMonths = Array.from({ length: endMonth - startMonth + 1 }, (_, i) => startMonth + i).filter((m) => windowMonths.has(m));
    const expCat = await tx.expense.groupBy({
      by: ["category"], where: { year, month: { in: expMonths }, clientId: id }, _sum: { amount: true },
    });
    // 지출은 부가세 미포함(원장 원값).
    const expenses: ExpenseSlice[] = expCat.map((r) => ({ category: r.category, amount: r._sum.amount ?? 0 }));
    const map = (rows: { month: number; _sum: { amount: number | null } }[]) =>
      new Map(rows.map((r) => [r.month, r._sum.amount ?? 0]));
    const pTax = map(perfMTaxable), pEx = map(perfMExempt), b = map(billM), d = map(depM), e = map(expM), cc = map(ccM);
    const monthly: MonthlyRow[] = Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      // 실적은 프로젝트 과업에서 직접 산출(창 무관). 청구·입금·지출은 계약기간 창에 속하는 월만 귀속.
      const inWindow = windowMonths.has(month);
      return {
        month,
        performance: withVatSplit(pTax.get(month) ?? 0, pEx.get(month) ?? 0, includeVat),
        billing: inWindow ? withVat(b.get(month) ?? 0, includeVat) : 0,
        deposit: inWindow ? withVat(d.get(month) ?? 0, includeVat) : 0,
        // 지출은 부가세 미포함(원장 원값).
        expense: inWindow ? (e.get(month) ?? 0) + (ce.get(month) ?? 0) + (cc.get(month) ?? 0) : 0,
      };
    });

    return { client: { id: client.id, name: client.name, status: client.status }, contract, tasks: taskRows, monthly, expenses };
  });
}

export type ProjectBreakdownRow = {
  id: string;
  name: string;
  contractStart: string | null; // "yyyy-mm-dd" | null
  contractEnd: string | null;
  performanceContract: boolean;
  performance: number;
  billing: number;
  deposit: number;
  expense: number;
  contract: number;
};

function toYm(d: Date): Ym {
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

// 청구·입금·지출을 귀속할 월 집합(선택 연도 내). getClientProjectBreakdown의 기간 창 규칙과 동일:
// 프로젝트 기준(fiscalBasis=false)이고 계약기간이 있으면 그 창에 속하는 월만, 아니면(회계연도 기준
// 또는 계약기간 없음 / 프로젝트 미선택) 전체 12개월.
function projectWindowMonths(
  year: number,
  project: { contractStart: Date | null; contractEnd: Date | null } | null,
  fiscalBasis: boolean,
): Set<number> {
  const all = new Set(Array.from({ length: 12 }, (_, i) => i + 1));
  if (!project || fiscalBasis || !project.contractStart || !project.contractEnd) return all;
  const [from, to] = orderRange(toYm(project.contractStart), toYm(project.contractEnd));
  const res = new Set<number>();
  for (let m = 1; m <= 12; m++) {
    const geFrom = year > from.year || (year === from.year && m >= from.month);
    const leTo = year < to.year || (year === to.year && m <= to.month);
    if (geFrom && leTo) res.add(m);
  }
  return res;
}

// 고객사의 프로젝트별 요약. 재무 데이터는 고객사 단위로 저장되므로, 각 프로젝트의 기간 창으로
// 잘라 귀속한다(프로젝트가 시간상 겹치지 않는다는 전제).
// - fiscalBasis=false(프로젝트 기준): 프로젝트 계약기간(contractStart~End) 월범위로 집계.
//   계약기간이 비어 있으면 선택 연도(1~12월)로 대체한다.
// - fiscalBasis=true(회계연도 기준): 선택 연도(1~12월)로 집계.
export function getClientProjectBreakdown(
  ctx: RlsContext,
  clientId: string,
  year: number,
  includeVat = false,
  fiscalBasis = false,
): Promise<ProjectBreakdownRow[]> {
  return withRLS(ctx, async (tx) => {
    const projects = await tx.project.findMany({
      where: { clientId, deletedAt: null },
      // 계약 시작일이 최신인 프로젝트가 위로. 시작일 없으면 등록일 최신순.
      orderBy: [{ contractStart: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      include: { tasks: { select: { id: true, contractAmount: true, vatExempt: true } } },
    });
    const rows: ProjectBreakdownRow[] = [];
    for (const p of projects) {
      // 기간 창 결정.
      const [from, to] =
        !fiscalBasis && p.contractStart && p.contractEnd
          ? orderRange(toYm(p.contractStart), toYm(p.contractEnd))
          : [{ year, month: 1 }, { year, month: 12 }];
      const ym = eachMonth(from, to).map((m) => ({ year: m.year, month: m.month }));
      // 실적·계약금 모두 면세/과세를 나눠 집계(과세분만 부가세 적용).
      const taxableIds = p.tasks.filter((t) => !t.vatExempt).map((t) => t.id);
      const exemptIds = p.tasks.filter((t) => t.vatExempt).map((t) => t.id);

      // 순차 await (같은 tx에서 병렬 쿼리 금지).
      const perfTaxable = taxableIds.length
        ? (await tx.monthlyPerformance.aggregate({ where: { taskId: { in: taxableIds }, OR: ym }, _sum: { amount: true } }))._sum.amount ?? 0
        : 0;
      const perfExempt = exemptIds.length
        ? (await tx.monthlyPerformance.aggregate({ where: { taskId: { in: exemptIds }, OR: ym }, _sum: { amount: true } }))._sum.amount ?? 0
        : 0;
      const billing = (await tx.monthlyBilling.aggregate({ where: { clientId, OR: ym }, _sum: { amount: true } }))._sum.amount ?? 0;
      const deposit = (await tx.monthlyDeposit.aggregate({ where: { clientId, OR: ym }, _sum: { amount: true } }))._sum.amount ?? 0;
      const expense = (await tx.expense.aggregate({ where: { clientId, OR: ym }, _sum: { amount: true } }))._sum.amount ?? 0;
      const consulting = (await tx.consultingExpense.aggregate({
        where: fiscalBasis ? { clientId, OR: ym } : { clientId, sessionDate: sessionDateBetween(from, to) },
        _sum: { amount: true },
      }))._sum.amount ?? 0;
      const corporateCard = (await tx.corporateCardExpense.aggregate({ where: { clientId, OR: ym }, _sum: { amount: true } }))._sum.amount ?? 0;
      const contractTaxable = p.tasks.reduce((s, t) => s + (t.vatExempt ? 0 : t.contractAmount ?? 0), 0);
      const contractExempt = p.tasks.reduce((s, t) => s + (t.vatExempt ? t.contractAmount ?? 0 : 0), 0);

      const start = p.contractStart ? p.contractStart.toISOString().slice(0, 10) : null;
      const end = p.contractEnd ? p.contractEnd.toISOString().slice(0, 10) : null;
      rows.push({
        id: p.id,
        // 프로젝트명은 계약기간 연도로 표기(설정 화면과 동일 규칙, "년" 제외). 계약기간이 없으면 저장된 name으로 폴백.
        name: deriveProjectName(start ?? "", end ?? "").replaceAll("년", "") || p.name,
        contractStart: start,
        contractEnd: end,
        performanceContract: p.performanceContract,
        performance: withVatSplit(perfTaxable, perfExempt, includeVat),
        billing: withVat(billing, includeVat),
        deposit: withVat(deposit, includeVat),
        // 지출은 부가세 미포함(원장 원값).
        expense: expense + consulting + corporateCard,
        contract: withVatSplit(contractTaxable, contractExempt, includeVat),
      });
    }
    return rows;
  });
}
