import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { parsePeriodParams, PERIOD_OPTIONS_WITH_QUARTERS } from "@/lib/period";
import { getClientDetail, getClientProjectBreakdown, getClientTaskMatrix } from "@/lib/data/metrics";
import { yearSpan } from "@/lib/clients/project-span";
import { PeriodSpanBadge } from "@/components/clients/PeriodSpanBadge";
import { listClientMemos } from "@/lib/data/clientMemos";
import { attainment, billingRate, collectionRate } from "@/lib/metrics/formulas";
import { getIncludeVat } from "@/lib/vat";
import { getFiscalBasis } from "@/lib/basis";
import { formatWon, formatPercent, formatDateTime } from "@/lib/format";
import { expenseCategoryLabel } from "@/lib/labels";
import { KpiCard } from "@/components/charts/KpiCard";
import { FunnelChart } from "@/components/charts/FunnelChart";
import { DonutChart } from "@/components/charts/DonutChart";
import { PeriodFilter } from "@/components/dashboard/PeriodFilter";
import { TaskPerfTable } from "@/components/dashboard/TaskPerfTable";

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
  const includeVat = await getIncludeVat();
  const fiscalBasis = await getFiscalBasis();

  // 전사 대시보드처럼 프로젝트 선택 없이 연도+기간으로 고객사 전체를 집계한다.
  // (프로젝트별 상세는 아래 "프로젝트별 요약" 표가 각 프로젝트를 나눠 보여준다.)
  const projectRows = await getClientProjectBreakdown(ctx, id, year, includeVat, fiscalBasis);
  const detail = await getClientDetail(ctx, id, year, period, includeVat, fiscalBasis);
  if (!detail) notFound();
  // 과업별 월 실적 표는 고객사 전 과업을 선택 연도 1~12월로 전개한다.
  const taskMatrix = await getClientTaskMatrix(ctx, id, undefined, includeVat, year);
  // 특이사항 메모(이력, 최신순). 작성·수정은 고객사 상세 설정 화면에서만, 여기선 읽기 전용.
  const memos = await listClientMemos(ctx, id);

  // 가장 최근 프로젝트(= 계약시작 최신순 정렬의 첫 행)의 계약기간 연도 스팬 배지(m/s).
  const latestSpan = yearSpan(projectRows[0]?.contractStart ?? null, projectRows[0]?.contractEnd ?? null);

  const perf = detail.tasks.reduce((s, t) => s + t.total, 0);
  const contract = detail.contract;
  const billing = detail.monthly.reduce((s, m) => s + m.billing, 0);
  const deposit = detail.monthly.reduce((s, m) => s + m.deposit, 0);
  // 모든 프로젝트가 실적 계약이면 "실적 계약 고객사"로 보고, 달성률 대신 "전년 대비"(실적/전년도 실적)로 표기한다.
  const isPerfClient = projectRows.length > 0 && projectRows.every((p) => p.performanceContract);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="flex items-center gap-1.5 text-xl font-semibold">
          {detail.client.name}
          <PeriodSpanBadge span={latestSpan} />
        </h1>
        <a
          href={`/clients/${id}/export?year=${year}&period=${period}`}
          className="rounded border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-primary)]"
        >
          CSV 내보내기
        </a>
      </div>
      {memos.length > 0 && (
        <section className="mb-6 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-hover)] p-5">
          <h2 className="mb-3 text-sm font-semibold text-[var(--color-fg)]">📝 특이사항 메모</h2>
          <ul className="flex flex-col gap-2">
            {memos.map((m) => (
              <li key={m.id} className="rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                <p className="whitespace-pre-wrap text-sm text-[var(--color-fg)]">{m.content}</p>
                <p className="mt-1.5 text-xs text-[var(--color-muted)]">
                  {(m.author?.name ?? m.author?.email ?? "(알 수 없음)")} · {formatDateTime(m.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <PeriodFilter
        year={year}
        period={period}
        action={`/clients/${id}`}
        options={PERIOD_OPTIONS_WITH_QUARTERS}
      />

      <section className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard title="수익률" value="준비중" />
        <KpiCard title={isPerfClient ? "전년 대비" : "달성률"} value={formatPercent(attainment(perf, isPerfClient ? detail.baseline : contract))} />
        <KpiCard title="청구율" value={formatPercent(billingRate(billing, perf))} />
        <KpiCard title="수금률" value={formatPercent(collectionRate(deposit, billing))} />
      </section>

      <section className="mb-8 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-fg)]">
          프로젝트별 요약 <span className="font-normal text-[var(--color-muted)]">({fiscalBasis ? "회계연도 기준 · " + year + "년" : "프로젝트 기준 · 계약기간"})</span>
        </h2>
        {projectRows.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">등록된 프로젝트가 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
                  <th className="py-2 pr-3">프로젝트</th>
                  <th className="px-2 whitespace-nowrap">계약기간</th>
                  <th className="px-2 text-right">{isPerfClient ? "전년 대비" : "전체 달성률"}</th>
                  <th className="px-2 text-right">실적</th>
                  <th className="px-2 text-right">청구</th>
                  <th className="px-2 text-right">입금</th>
                  <th className="px-2 text-right">지출</th>
                  <th className="px-2 text-right">계약금</th>
                </tr>
              </thead>
              <tbody>
                {projectRows.map((p) => (
                  <tr key={p.id} className="border-b border-[var(--color-border)]">
                    <td className="py-2 pr-3 whitespace-nowrap">{p.name}</td>
                    <td className="px-2 whitespace-nowrap text-[var(--color-muted)]">
                      {p.contractStart && p.contractEnd ? `${p.contractStart} ~ ${p.contractEnd}` : "—"}
                    </td>
                    <td className="px-2 text-right whitespace-nowrap">
                      {p.performanceContract
                        ? p.baseline > 0
                          ? formatPercent(attainment(p.totalPerformance, p.baseline))
                          : "실적 계약"
                        : formatPercent(attainment(p.totalPerformance, p.contract))}
                    </td>
                    <td className="px-2 text-right whitespace-nowrap">{formatWon(p.totalPerformance)}</td>
                    <td className="px-2 text-right whitespace-nowrap">{formatWon(p.billing)}</td>
                    <td className="px-2 text-right whitespace-nowrap">{formatWon(p.deposit)}</td>
                    <td className="px-2 text-right whitespace-nowrap">{formatWon(p.expense)}</td>
                    <td className="px-2 text-right whitespace-nowrap">{formatWon(p.contract)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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

      {taskMatrix && <TaskPerfTable matrix={taskMatrix} />}

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
