import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { canViewWeeklyMembers, canWriteWeeklyShare } from "@/lib/auth/rbac";
import { prevWeek, weekLabel, weekRange, weeksOverlappingMonth } from "@/lib/week";
import { loadWeeklyBatch } from "@/lib/data/weekly-share";
import { canEditBids, canSeeBidsTab, canSeeStatusTab, visibleTabs } from "./tabs";
import { WeeklyTabs } from "./WeeklyTabs";
import { WeeklyFilter, type WeekChip } from "./WeeklyFilter";
import { WeeklyBatch } from "./WeeklyBatch";
import { HistoryView, type HistoryParams } from "./HistoryView";
import { PartStatusView, type StatusParams } from "./PartStatusView";
import { BidsView, type BidParams } from "./BidsView";
import { loadAdminLists, weeklyRange } from "./range";

type SearchParams = HistoryParams & StatusParams & BidParams & { tab?: string; week?: string };

export default async function WeeklySharePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const user = await requireUser();
  // 정산담당자는 이 메뉴가 없다. 역할이 없으면 접근할 수 없다.
  if (!user.role || user.role === "SETTLEMENT") redirect("/");
  const ctx = getRlsContext(user);
  const writer = canWriteWeeklyShare(user.role);
  // 파트 현황·입찰·수주는 최고관리자·팀 관리자·파트장만(파트장은 파트 현황에서 본인 파트만, 입찰은 보기만).
  // 그 외 역할이 주소로 들어오면 일지작성 탭으로 돌려보낸다.
  const tab =
    sp.tab === "history"
      ? "history"
      : sp.tab === "status" && canSeeStatusTab(user.role)
        ? "status"
        : sp.tab === "bids" && canSeeBidsTab(user.role)
          ? "bids"
          : "batch";
  const isLeader = user.role === "PART_LEADER";

  const range = await weeklyRange(ctx, sp.ym);
  // 관리자와 파트장은 히스토리·파트 현황에서 고를 수 있는 파트·담당자 목록이 필요하다. 파트장은 본인 파트 범위로 좁혀져 나온다.
  const viewsMembers = canViewWeeklyMembers(user.role);
  const adminLists = viewsMembers ? await loadAdminLists(user) : null;

  const header = (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">주간 공유</h1>
      </div>
      <WeeklyTabs tabs={visibleTabs(user.role)} current={tab} />
    </>
  );

  if (tab === "bids") {
    return (
      <div>
        {header}
        <BidsView ctx={ctx} sp={sp} canEdit={canEditBids(user.role)} />
      </div>
    );
  }

  if (tab === "status" && adminLists) {
    return (
      <div>
        {header}
        <PartStatusView ctx={ctx} user={user} range={range} sp={sp} adminLists={adminLists} partFixed={isLeader} />
      </div>
    );
  }

  if (tab === "history") {
    return (
      <div>
        {header}
        <HistoryView ctx={ctx} user={user} writer={writer} viewsMembers={viewsMembers} isLeader={isLeader} range={range} sp={sp} adminLists={adminLists} />
      </div>
    );
  }

  // ---- 주간 공유 탭: 월(기본 = 이번 주 소속 월)과 주(일~토, 키=일요일). 미래 주는 선택할 수 없다 ----
  const { curWeek, ym, minYm, maxYm } = range;
  const weekKeys = weeksOverlappingMonth(ym.year, ym.month);
  const selectable = weekKeys.filter((k) => k <= curWeek);
  const week =
    sp.week && selectable.includes(sp.week)
      ? sp.week
      : selectable.includes(curWeek)
        ? curWeek
        : selectable[selectable.length - 1] ?? weekKeys[0];

  // ---- 일지작성은 항상 본인 것: 담당 고객사 카드(없으면 비어 있음)와 기타 업무. 다른 사람의 기록은 히스토리 탭에서 본다 ----
  const data = await loadWeeklyBatch(ctx, { pmId: user.id, weekStart: week, prevWeekStart: prevWeek(week), weeks: weekKeys });

  const total = data.clients.length;
  const chips: WeekChip[] = weekKeys.map((key) => {
    const n = data.weekStatus[key] ?? 0;
    return {
      key,
      label: weekLabel(key),
      range: weekRange(key),
      status: total > 0 && n >= total ? "done" : n > 0 ? "part" : "none",
      future: key > curWeek,
    };
  });

  return (
    <div>
      {header}
      <WeeklyFilter ym={ym} minYm={minYm} maxYm={maxYm} weeks={chips} selectedWeek={week} />
      <WeeklyBatch
        key={`${user.id}|${week}|${ym.year}-${ym.month}`}
        weekStart={week}
        year={ym.year}
        month={ym.month}
        clients={data.clients}
        other={data.other}
      />
    </div>
  );
}
