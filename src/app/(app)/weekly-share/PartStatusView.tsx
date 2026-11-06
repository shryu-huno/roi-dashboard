import { Fragment } from "react";
import Link from "next/link";
import type { RlsContext } from "@/lib/rls";
import { getIncludeVat } from "@/lib/vat";
import { clampYm, YEAR_MIN, type Ym } from "@/lib/month-range";
import { formatPercent, formatWon, formatWonCompact } from "@/lib/format";
import { colorAt, METER } from "@/lib/chart-colors";
import { loadPartStatusFacts } from "@/lib/data/part-status";
import { directory, partCards, periodTable, trendSeries, type PartGroup, type PartStatusInput } from "@/lib/part-status";
import type { AdminLists, WeeklyRange } from "./range";
import { PartStatusFilter } from "./PartStatusFilter";
import { PartTrendChart } from "./PartTrendChart";

// 파트 현황 탭의 조회 조건(URL 쿼리).
export type StatusParams = {
  part?: string; // 파트 id, 비우면 전체
  year?: string; // 집계 연도(기본: 올해)
  month?: string; // "all"(기본, 연도 누적만) 또는 1~12(그 달 실적·최근 3개월 기준)
  tv?: string; // q(분기별) | r3(최근 3개월)
};

const card = "rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)]";
const th = "px-3 py-3 text-center text-sm font-bold text-[var(--color-muted)] whitespace-nowrap";
const td = "px-3 py-3 text-center align-middle tabular-nums";
const num = (n: number) => Math.round(n).toLocaleString("ko-KR");

function RateBar({ rate }: { rate: number | null }) {
  const pct = rate === null ? 0 : Math.min(100, Math.round(rate * 100));
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-block h-1.5 w-14 overflow-hidden rounded-full align-middle" style={{ background: METER.track }}>
        <i className="block h-full rounded-full" style={{ width: `${pct}%`, background: METER.fill }} />
      </span>
      <span>{formatPercent(rate)}</span>
    </span>
  );
}

export async function PartStatusView({
  ctx, range, sp, adminLists,
}: {
  ctx: RlsContext;
  range: WeeklyRange;
  sp: StatusParams;
  adminLists: AdminLists;
}) {
  const includeVat = await getIncludeVat();
  const { maxYm } = range;
  const minYm: Ym = { year: YEAR_MIN, month: 1 };
  // 연도는 [2000, 올해], 월은 기본 "전체". 올해라면 아직 오지 않은 달은 고를 수 없다(이번 달로 맞춘다).
  const askedYear = Number(sp.year);
  const year = Number.isInteger(askedYear) ? clampYm({ year: askedYear, month: 1 }, minYm, maxYm).year : maxYm.year;
  const askedMonth = Number(sp.month);
  const month: number | null =
    sp.month && sp.month !== "all" && Number.isInteger(askedMonth) && askedMonth >= 1 && askedMonth <= 12
      ? clampYm({ year, month: askedMonth }, minYm, maxYm).month
      : null;
  const tv = sp.tv === "r3" ? "r3" : "q";
  const lastMonth = year < maxYm.year ? 12 : maxYm.month;
  const partialMonth = year === maxYm.year ? maxYm.month : null;

  // 파트가 없는 PM은 "파트 미지정" 그룹으로 모아 합계가 어긋나지 않게 한다.
  const known = new Set(adminLists.parts.map((p) => p.id));
  const pms = adminLists.pms.map((p) => ({ id: p.id, name: p.name, groupId: p.partId && known.has(p.partId) ? p.partId : "none" }));
  const groups: PartGroup[] = [
    ...adminLists.parts.map((p) => ({ id: p.id, name: p.name })),
    ...(pms.some((p) => p.groupId === "none") ? [{ id: "none", name: "파트 미지정" }] : []),
  ];
  const partId = groups.some((g) => g.id === sp.part) ? (sp.part as string) : "";
  const groupId = partId || "all";

  if (groups.length === 0 || pms.length === 0) {
    return (
      <p className={`${card} border-dashed p-8 text-center text-[var(--color-muted)]`}>
        {groups.length === 0 ? "파트가 아직 없습니다. 팀 관리에서 파트를 만들어 주세요." : "조회할 수 있는 PM이 없습니다."}
      </p>
    );
  }

  const facts = await loadPartStatusFacts(ctx, { pmIds: pms.map((p) => p.id), year });
  const input: PartStatusInput = { groups, pms, clientsByPm: facts.clientsByPm, clients: facts.clients, includeVat };

  const cards = partCards(input, month);
  const selected = cards.find((c) => c.id === groupId) ?? cards[0];
  const trend = trendSeries(input, groupId);
  const table = periodTable(input, { groupId, view: tv, month, lastMonth });
  const dir = directory(input, groupId);
  const colorOf = (id: string) => colorAt(Math.max(0, groups.findIndex((g) => g.id === id)));
  const series = trend.series.map((s) => ({ ...s, color: colorOf(s.id) }));

  const href = (o: { month?: number | "all"; part?: string; tv?: string }) => {
    const p = new URLSearchParams({ tab: "status", year: String(year), month: String(o.month ?? month ?? "all"), tv: o.tv ?? tv });
    const part = o.part ?? partId;
    if (part) p.set("part", part);
    return `/weekly-share?${p.toString()}`;
  };
  const monthHrefs = Array.from({ length: 12 }, (_, i) => href({ month: i + 1 }));
  const partName = partId ? groups.find((g) => g.id === partId)?.name ?? "" : "";

  return (
    <div className="flex flex-col gap-4">
      <PartStatusFilter groups={groups} partId={partId} year={year} month={month} minYm={minYm} maxYm={maxYm} tv={tv} />

      <div className={`${card} flex flex-wrap items-center gap-x-5 gap-y-1 px-5 py-3 text-sm text-[var(--color-muted)]`}>
        <span>
          <b className="text-[var(--color-fg)]">{partName || "전체"}</b> · PM {selected.pmCount}명 · 고객사 {selected.clientCount}곳
        </span>
        <span>{year}년 누적 <b className="text-[var(--color-fg)]">{formatWon(selected.cumulative)}</b></span>
        {month !== null && <span>{month}월 실적 <b className="text-[var(--color-fg)]">{formatWon(selected.monthAmount ?? 0)}</b></span>}
        <span className="ml-auto text-xs">부가세 {includeVat ? "포함" : "미포함"} 기준 · 전체 현황과 같은 계산식</span>
      </div>

      {/* 파트별 요약 카드: 누르면 그 파트로 차트·표가 바뀌고, 다시 누르면 전체로 돌아온다 */}
      <section aria-label="파트별 요약" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => {
          const active = c.id === groupId;
          const pct = c.rate === null ? 0 : Math.min(100, Math.round(c.rate * 100));
          return (
            <Link
              key={c.id}
              href={href({ part: c.id === "all" || active ? "" : c.id })}
              aria-pressed={active}
              className={`flex flex-col gap-3 rounded-[14px] border p-4 ${
                active ? "border-[var(--color-primary)] ring-4 ring-[var(--color-hover)]" : "border-[var(--color-border)] hover:border-[var(--color-muted)]"
              } ${c.id === "all" ? "bg-[var(--color-bg)]" : "bg-[var(--color-surface)]"}`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="flex items-center gap-1.5 text-[15px] font-bold">
                  {c.id !== "all" && <i className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: colorOf(c.id) }} />}
                  {c.name}
                </h3>
                <span className="text-xs text-[var(--color-muted)]">PM {c.pmCount}명 · 고객사 {c.clientCount}곳</span>
              </div>
              <div>
                <div className="text-xs text-[var(--color-muted)]">{year}년 누적 실적</div>
                <div className="text-xl font-bold tracking-tight tabular-nums">
                  {num(c.cumulative)}
                  <small className="ml-0.5 text-[13px] font-semibold text-[var(--color-muted)]">원</small>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between gap-2 text-xs text-[var(--color-muted)]">
                  <span>계약 {num(c.contract)}원 대비</span>
                  <b className="tabular-nums text-[var(--color-fg)]">{formatPercent(c.rate)}</b>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full" style={{ background: METER.track }} role="img" aria-label={`달성률 ${formatPercent(c.rate)}`}>
                  <i className="block h-full rounded-full" style={{ width: `${pct}%`, background: METER.fill }} />
                </div>
              </div>
              {c.monthAmount !== null && (
                <div className="text-xs text-[var(--color-muted)]">
                  {month}월 실적 <b className="tabular-nums text-[var(--color-fg)]">{num(c.monthAmount)}</b>원
                </div>
              )}
            </Link>
          );
        })}
      </section>

      <section className={`${card} p-5`}>
        <div className="mb-3 flex flex-wrap items-baseline gap-3">
          <h2 className="text-base font-semibold">월별 실적 추이</h2>
          <span className="text-sm text-[var(--color-muted)]">{year}년 1~12월 · {partName || "파트별 누적 막대"}</span>
        </div>
        <PartTrendChart
          year={year}
          selectedMonth={month}
          partialMonth={partialMonth}
          lastMonth={lastMonth}
          series={series}
          totals={trend.totals}
          hrefs={monthHrefs}
        />
        {/* 표 보기: 청록처럼 대비가 낮은 색을 쓰는 경우에도 값을 모두 읽을 수 있게 한다 */}
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-[var(--color-primary)]">표로 보기</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  <th className={th}>월</th>
                  {series.map((s) => (
                    <th key={s.id} className={th}>
                      <span className="inline-flex items-center gap-1.5">
                        <i className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} />
                        {s.name}
                      </span>
                    </th>
                  ))}
                  {series.length > 1 && <th className={th}>합계</th>}
                </tr>
              </thead>
              <tbody>
                {trend.totals.map((total, i) => (
                  <tr key={i} className="border-b border-[var(--color-border)]">
                    <td className={td}>{i + 1}월</td>
                    {series.map((s) => (
                      <td key={s.id} className={td}>{i + 1 > lastMonth ? "—" : num(s.values[i])}</td>
                    ))}
                    {series.length > 1 && <td className={td}>{i + 1 > lastMonth ? "—" : num(total)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <section className={`${card} p-5`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="text-base font-semibold">{tv === "q" ? "분기별 실적" : "최근 3개월 실적"}</h2>
            {tv === "r3" && month === null && <span className="text-sm text-[var(--color-muted)]">가장 최근 달({lastMonth}월) 기준</span>}
            <span className="text-sm text-[var(--color-muted)]">{partName ? `${partName} PM별` : "파트별"} · 단위 원</span>
          </div>
          <div className="inline-flex gap-0.5 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-bg)] p-0.5" role="group" aria-label="표 보기">
            {(
              [
                ["q", "분기별"],
                ["r3", "최근 3개월"],
              ] as const
            ).map(([k, label]) => (
              <Link
                key={k}
                href={href({ tv: k })}
                aria-pressed={tv === k}
                className={`rounded-[8px] px-3 py-1.5 text-sm font-medium ${tv === k ? "bg-[var(--color-surface)] text-[var(--color-primary)] shadow-sm" : "text-[var(--color-muted)]"}`}
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className={th}>{partName ? "PM" : "파트"}</th>
                {table.columns.map((c, i) => (
                  <th key={c} className={`${th} ${i === table.currentIndex ? "bg-[var(--color-hover)] text-[var(--color-primary)]" : ""}`}>{c}</th>
                ))}
                <th className={th}>{year}년 누적</th>
                <th className={th}>계약금</th>
                <th className={th}>달성률</th>
              </tr>
            </thead>
            <tbody>
              {[...table.rows, table.total].map((r, idx) => {
                const isTotal = idx === table.rows.length;
                return (
                  <tr key={r.id} className={`border-b border-[var(--color-border)] last:border-b-0 ${isTotal ? "font-bold" : ""}`}>
                    <td className={`${td} font-semibold`}>
                      <span className="inline-flex items-center gap-1.5">
                        {!isTotal && !partName && <i className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: colorOf(r.id) }} />}
                        {r.label}
                      </span>
                    </td>
                    {r.values.map((v, i) => (
                      <td key={i} className={`${td} ${i === table.currentIndex ? "bg-[var(--color-hover)]" : ""}`}>
                        {v === null ? <span className="text-[var(--color-muted)]">—</span> : num(v)}
                      </td>
                    ))}
                    <td className={td}>{num(r.cumulative)}</td>
                    <td className={td}>{num(r.contract)}</td>
                    <td className={td}><RateBar rate={r.rate} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className={`${card} p-5`}>
        <div className="mb-1 flex flex-wrap items-baseline gap-3">
          <h2 className="text-base font-semibold">파트별 PM 담당 고객사</h2>
          <span className="text-sm text-[var(--color-muted)]">고객사 옆 금액은 {year}년에 귀속되는 계약금이에요(달성률 계산과 같은 기준).</span>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] table-fixed text-sm">
            <colgroup>
              <col style={{ width: "14%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "50%" }} />
              <col style={{ width: "26%" }} />
            </colgroup>
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className={th}>PM</th>
                <th className={th}>고객사 수</th>
                <th className={th}>담당 고객사 · 계약 금액</th>
                <th className={th}>계약 금액 합계</th>
              </tr>
            </thead>
            <tbody>
              {dir.groups.map((g) => (
                <Fragment key={g.id}>
                  <tr className="bg-[var(--color-bg)]">
                    <td colSpan={4} className="px-3 py-2 text-sm font-bold">
                      <span className="inline-flex items-center gap-1.5">
                        <i className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: colorOf(g.id) }} />
                        {g.name}
                      </span>
                      <span className="ml-3 font-medium text-[var(--color-muted)]">
                        PM {g.pmCount}명 · 고객사 {g.clientCount}곳 · 계약 금액 {num(g.contract)}원
                      </span>
                    </td>
                  </tr>
                  {g.pms.map((p) => (
                    <tr key={p.id} className="border-b border-[var(--color-border)]">
                      <td className={`${td} font-semibold`}>{p.name}</td>
                      <td className={td}><b>{p.clientCount}</b>곳</td>
                      <td className="px-3 py-3 align-middle">
                        <div className="flex flex-wrap justify-center gap-1.5">
                          {p.clients.length === 0 ? (
                            <span className="text-[var(--color-muted)]">—</span>
                          ) : (
                            p.clients.map((c) => (
                              <span
                                key={c.id}
                                title={`계약금 ${num(c.contract)}원`}
                                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] px-2.5 py-1 text-xs"
                              >
                                {c.name}
                                <small className="tabular-nums text-[var(--color-muted)]">{formatWonCompact(c.contract)}</small>
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td className={td}><b>{num(p.contract)}</b>원</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-[var(--color-border)] font-bold">
                <td className={td}>합계 <span className="text-xs font-normal text-[var(--color-muted)]">PM {dir.total.pmCount}명</span></td>
                <td className={td}>{dir.total.clientCount}곳</td>
                <td />
                <td className={td}>{num(dir.total.contract)}원</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  );
}
