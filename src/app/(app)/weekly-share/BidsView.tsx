import type { RlsContext } from "@/lib/rls";
import { clampYm, intParam, YEAR_MIN, type Ym } from "@/lib/month-range";
import { kstToday } from "@/lib/week";
import { formatWonCompact } from "@/lib/format";
import { listBids } from "@/lib/data/bids";
import { bidStats, daysUntil, filterByStatus, formatBidDate, scopeBids, sortBids, type BidStatusFilter } from "@/lib/bids";
import { BidFilter } from "./BidFilter";
import { BidTable } from "./BidTable";

// 입찰·수주 탭의 조회 조건(URL 쿼리).
export type BidParams = {
  status?: string; // all | live | won | closed
  due?: string; // all | month (제출 마감 기간)
  year?: string; // 월별일 때 연도
  month?: string; // 월별일 때 월
  q?: string; // 검색어(발주처·사업명·비고)
};

const STATUS_VALUES: BidStatusFilter[] = ["all", "live", "won", "closed"];

export async function BidsView({ ctx, sp, canEdit }: { ctx: RlsContext; sp: BidParams; canEdit: boolean }) {
  const today = kstToday();
  const thisYear = Number(today.slice(0, 4));
  // 제출 마감은 앞으로 올 날짜라 연도 이동은 내후년까지 연다.
  const minYm: Ym = { year: YEAR_MIN, month: 1 };
  const maxYm: Ym = { year: thisYear + 2, month: 12 };
  const status: BidStatusFilter = STATUS_VALUES.includes(sp.status as BidStatusFilter) ? (sp.status as BidStatusFilter) : "all";
  const due = sp.due === "month" ? "month" : "all";
  const askedYear = intParam(sp.year);
  const askedMonth = intParam(sp.month);
  const ym = clampYm(
    {
      year: askedYear ?? thisYear,
      month: askedMonth !== null && askedMonth >= 1 && askedMonth <= 12 ? askedMonth : Number(today.slice(5, 7)),
    },
    minYm,
    maxYm,
  );
  const q = sp.q ?? "";

  const all = await listBids(ctx);
  const scope = scopeBids(all, { ym: due === "month" ? ym : null, q }); // 통계는 상태와 무관하게 이 범위 기준
  const stats = bidStats(scope, today);
  const list = sortBids(filterByStatus(scope, status));
  const nextDays = stats.next ? daysUntil(stats.next.dueDate, today) : null;

  return (
    <div className="flex flex-col gap-4">
      <BidFilter status={status} due={due} ym={ym} minYm={minYm} maxYm={maxYm} q={q} />

      <section aria-label="입찰 요약" className="grid grid-cols-2 overflow-hidden rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] lg:grid-cols-4">
        <Stat label="진행 중 (준비·심사)" value={`${stats.live.count}`} unit="건" sub={`입찰 금액 ${formatWonCompact(stats.live.amount)}원`} />
        <Stat label="수주" value={`${stats.won.count}`} unit="건" sub={`수주 금액 ${formatWonCompact(stats.won.amount)}원`} border />
        <Stat
          label="수주율"
          value={stats.rate === null ? "—" : String(Math.round(stats.rate * 100))}
          unit={stats.rate === null ? "" : "%"}
          sub={`결과 나온 ${stats.decided}건 기준 (유찰 제외)`}
          border
        />
        <Stat
          label="가장 가까운 제출 마감"
          value={stats.next ? stats.next.orgName : "없음"}
          sub={stats.next ? `${formatBidDate(stats.next.dueDate)} · ${nextDays === 0 ? "오늘" : `D-${nextDays}`}` : "예정된 입찰 없음"}
          small
          border
        />
      </section>

      <BidTable
        key={`${status}|${due}|${ym.year}-${ym.month}|${q}|${all.length}`}
        bids={list}
        today={today}
        canEdit={canEdit}
        summary={{ count: list.length, amount: list.reduce((s, b) => s + b.amount, 0) }}
      />
    </div>
  );
}

function Stat({
  label, value, unit, sub, border, small,
}: {
  label: string;
  value: string;
  unit?: string;
  sub: string;
  border?: boolean;
  small?: boolean;
}) {
  return (
    <div className={`min-w-0 px-5 py-4 ${border ? "border-[var(--color-border)] lg:border-l" : ""}`}>
      <div className="text-[12.5px] font-medium text-[var(--color-muted)]">{label}</div>
      <div className={`mt-0.5 truncate font-bold tracking-tight ${small ? "text-lg" : "text-[22px] tabular-nums"}`}>
        {value}
        {unit && <small className="ml-0.5 text-sm font-semibold text-[var(--color-muted)]">{unit}</small>}
      </div>
      <div className="mt-0.5 truncate text-xs text-[var(--color-muted)]">{sub}</div>
    </div>
  );
}
