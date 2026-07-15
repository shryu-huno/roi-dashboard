import { requireUser } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { hasAtLeast } from "@/lib/auth/rbac";
import { parsePeriodParams } from "@/lib/period";
import {
  getPeriodTotals, getContractTotal, getMonthlyTrend,
  getExpenseBreakdown, getClientSummaries, rollupPmSummaries,
} from "@/lib/data/metrics";
import { margin, attainment, billingRate, collectionRate } from "@/lib/metrics/formulas";
import { getIncludeVat } from "@/lib/vat";
import { formatWon, formatPercent } from "@/lib/format";
import { expenseCategoryLabel } from "@/lib/labels";
import { KpiCard } from "@/components/charts/KpiCard";
import { FunnelChart } from "@/components/charts/FunnelChart";
import { DonutChart } from "@/components/charts/DonutChart";
import { TrendChart } from "@/components/charts/TrendChart";
import { BarList } from "@/components/charts/BarList";
import { PeriodFilter } from "@/components/dashboard/PeriodFilter";
import { ClientSummaryTable } from "@/components/dashboard/ClientSummaryTable";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; period?: string }>;
}) {
  const sp = await searchParams;
  const user = await requireUser();
  const ctx = getRlsContext(user);
  const { year, period } = parsePeriodParams(sp, new Date().getFullYear());
  const includeVat = await getIncludeVat();

  // 각 조회는 독립 트랜잭션이므로 병렬 실행 가능.
  const [totals, contract, trend, breakdown, clients] = await Promise.all([
    getPeriodTotals(ctx, year, period, includeVat),
    getContractTotal(ctx, includeVat),
    getMonthlyTrend(ctx, year, includeVat),
    getExpenseBreakdown(ctx, year, period, includeVat),
    getClientSummaries(ctx, year, period, includeVat),
  ]);
  const showPm = hasAtLeast(user.role, "SETTLEMENT");
  const pms = showPm ? rollupPmSummaries(clients) : [];

  const marginV = margin(totals.performance, totals.expense);
  const attainmentV = attainment(totals.performance, contract);

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">전사 대시보드</h1>
      <PeriodFilter year={year} period={period} />

      <section className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard title="수익률" value={formatPercent(marginV)} />
        <KpiCard title="실적 달성률" value={formatPercent(attainmentV)} sub={`계약금 ${formatWon(contract)}`} />
        <KpiCard title="총 실적" value={formatWon(totals.performance)} />
        <KpiCard title="총 지출" value={formatWon(totals.expense)} />
        <KpiCard title="총 입금" value={formatWon(totals.deposit)} />
      </section>

      <section className="mb-8 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-fg)]">수익 흐름</h2>
        <FunnelChart
          steps={[
            { label: "계약금", amount: contract, rate: null },
            { label: "실적", amount: totals.performance, rate: formatPercent(attainmentV) },
            { label: "청구", amount: totals.billing, rate: formatPercent(billingRate(totals.billing, totals.performance)) },
            { label: "입금", amount: totals.deposit, rate: formatPercent(collectionRate(totals.deposit, totals.billing)) },
          ]}
        />
      </section>

      <section className="mb-8 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-fg)]">월별 추이 (실적 막대 · 수익률 라인)</h2>
        <TrendChart
          points={trend.map((t) => ({
            month: t.month,
            performance: t.performance,
            margin: margin(t.performance, t.expense),
          }))}
        />
      </section>

      <section className="mb-8 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-fg)]">지출 구성</h2>
        <DonutChart segments={breakdown.map((s) => ({ label: expenseCategoryLabel(s.category), value: s.amount }))} />
      </section>

      {showPm && (
        <section className="mb-8 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <h2 className="mb-3 text-sm font-semibold text-[var(--color-fg)]">PM별 집계</h2>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
                <th className="py-2">PM</th><th>담당 고객사</th><th>실적</th><th>지출</th><th>수익률</th>
              </tr>
            </thead>
            <tbody>
              {pms.map((p) => (
                <tr key={p.pmId ?? "none"} className="border-b border-[var(--color-border)]">
                  <td className="py-2">{p.label}</td>
                  <td>{p.clientCount}</td>
                  <td>{formatWon(p.performance)}</td>
                  <td>{formatWon(p.expense)}</td>
                  <td>{formatPercent(margin(p.performance, p.expense))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-fg)]">고객사별 요약</h2>
        <ClientSummaryTable clients={clients} />
      </section>
    </div>
  );
}
