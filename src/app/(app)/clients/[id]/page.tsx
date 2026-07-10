import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { parsePeriodParams } from "@/lib/period";
import { getClientDetail } from "@/lib/data/metrics";
import { margin, attainment, billingRate, collectionRate } from "@/lib/metrics/formulas";
import { formatWon, formatPercent } from "@/lib/format";
import { expenseCategoryLabel } from "@/lib/labels";
import { KpiCard } from "@/components/charts/KpiCard";
import { FunnelChart } from "@/components/charts/FunnelChart";
import { DonutChart } from "@/components/charts/DonutChart";
import { PeriodFilter } from "@/components/dashboard/PeriodFilter";

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ year?: string; period?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const ctx = getRlsContext(user);
  const { year, period } = parsePeriodParams(sp, new Date().getFullYear());

  const detail = await getClientDetail(ctx, id, year, period);
  if (!detail) notFound();

  const perf = detail.tasks.reduce((s, t) => s + t.amount, 0);
  const contract = detail.tasks.reduce((s, t) => s + (t.contractAmount ?? 0), 0);
  const billing = detail.monthly.reduce((s, m) => s + m.billing, 0);
  const deposit = detail.monthly.reduce((s, m) => s + m.deposit, 0);
  const expense = detail.monthly.reduce((s, m) => s + m.expense, 0);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{detail.client.name}</h1>
        <a
          href={`/clients/${id}/export?year=${year}&period=${period}`}
          className="rounded border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-primary)]"
        >
          CSV 내보내기
        </a>
      </div>
      <PeriodFilter year={year} period={period} action={`/clients/${id}`} />

      <section className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard title="수익률" value={formatPercent(margin(perf, expense))} />
        <KpiCard title="달성률" value={formatPercent(attainment(perf, contract))} sub={`계약금 ${formatWon(contract)}`} />
        <KpiCard title="청구율" value={formatPercent(billingRate(billing, perf))} />
        <KpiCard title="수금률" value={formatPercent(collectionRate(deposit, billing))} />
      </section>

      <section className="mb-8 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-fg)]">수익 흐름</h2>
        <FunnelChart
          steps={[
            { label: "계약금", amount: contract, rate: null },
            { label: "실적", amount: perf, rate: formatPercent(attainment(perf, contract)) },
            { label: "청구", amount: billing, rate: formatPercent(billingRate(billing, perf)) },
            { label: "입금", amount: deposit, rate: formatPercent(collectionRate(deposit, billing)) },
          ]}
        />
      </section>

      <section className="mb-8 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-fg)]">과업별 실적 (선택 구간)</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
              <th className="py-2">과업</th><th>단가</th><th>계약금</th><th>횟수</th><th>금액</th>
            </tr>
          </thead>
          <tbody>
            {detail.tasks.map((t) => (
              <tr key={t.id} className="border-b border-[var(--color-border)]">
                <td className="py-2">{t.name}</td>
                <td>{formatWon(t.unitPrice)}</td>
                <td>{t.contractAmount == null ? "—" : formatWon(t.contractAmount)}</td>
                <td>{t.count}</td>
                <td>{formatWon(t.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mb-8 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-fg)]">지출 구성 (선택 구간)</h2>
        <DonutChart
          segments={detail.expenses.map((s) => ({ label: expenseCategoryLabel(s.category), value: s.amount }))}
        />
      </section>

      <section className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-fg)]">월별 실적·청구·입금 ({year})</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
              <th className="py-2">월</th><th>실적</th><th>청구</th><th>입금</th><th>지출</th><th>미수금</th>
            </tr>
          </thead>
          <tbody>
            {detail.monthly.map((m) => {
              const unpaid = m.billing - m.deposit;
              const isUnpaid = unpaid > 0;
              return (
                <tr key={m.month} className="border-b border-[var(--color-border)]">
                  <td className="py-2">{m.month}월</td>
                  <td>{formatWon(m.performance)}</td>
                  <td>{formatWon(m.billing)}</td>
                  <td>{formatWon(m.deposit)}</td>
                  <td>{formatWon(m.expense)}</td>
                  <td className={isUnpaid ? "font-semibold text-[var(--color-danger)]" : "text-[var(--color-muted)]"}>
                    {isUnpaid ? formatWon(unpaid) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-4">
          <Link href="/dashboard" className="text-sm text-[var(--color-primary)]">← 전사 대시보드</Link>
        </p>
      </section>
    </div>
  );
}
