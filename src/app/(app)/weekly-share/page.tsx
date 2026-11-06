import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { canWriteWeeklyShare } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { addMonths, parseYm, type Ym } from "@/lib/month-range";
import {
  currentWeek, kstToday, prevWeek, weekLabel, weekMonth, weekRange, weeksOverlappingMonth,
} from "@/lib/week";
import { earliestWeekStart, loadWeeklyBatch } from "@/lib/data/weekly-share";
import { WEEKLY_TABS } from "./tabs";
import { WeeklyTabs } from "./WeeklyTabs";
import { WeeklyFilter, type AdminPick, type WeekChip } from "./WeeklyFilter";
import { WeeklyBatch } from "./WeeklyBatch";

const idx = (y: Ym) => y.year * 12 + y.month;

export default async function WeeklySharePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; ym?: string; week?: string; part?: string; pm?: string }>;
}) {
  const sp = await searchParams;
  const user = await requireUser();
  // 정산담당자는 이 메뉴가 없다. 역할이 없으면 접근할 수 없다.
  if (!user.role || user.role === "SETTLEMENT") redirect("/");
  const ctx = getRlsContext(user);
  const writer = canWriteWeeklyShare(user.role);

  // ---- 기간: 월(기본 = 이번 주 소속 월)과 주(일~토, 키=일요일). 미래 주는 선택할 수 없다 ----
  const now = new Date();
  const curWeek = currentWeek(now);
  const curMonth = weekMonth(curWeek);
  const today = kstToday(now);
  const todayYm: Ym = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
  const maxYm = idx(curMonth) >= idx(todayYm) ? curMonth : todayYm;
  // 이동 범위: 데이터가 있는 가장 이른 달 ~ 이번 달. 첫 사용 때도 지난 기록을 쓸 수 있게 최소 최근 3개월은 열어 둔다.
  const earliest = await earliestWeekStart(ctx);
  const earliestYm = earliest ? weekMonth(earliest) : maxYm;
  const floorYm = addMonths(maxYm, -2);
  const minYm = idx(earliestYm) < idx(floorYm) ? earliestYm : floorYm;
  const asked = parseYm(sp.ym) ?? curMonth;
  const ym = idx(asked) > idx(maxYm) ? maxYm : idx(asked) < idx(minYm) ? minYm : asked;

  const weekKeys = weeksOverlappingMonth(ym.year, ym.month);
  const selectable = weekKeys.filter((k) => k <= curWeek);
  const week =
    sp.week && selectable.includes(sp.week)
      ? sp.week
      : selectable.includes(curWeek)
        ? curWeek
        : selectable[selectable.length - 1] ?? weekKeys[0];

  // ---- 누구의 주간 공유를 보는가: 작성 역할은 본인, 관리자는 PM을 골라 읽기 전용으로 본다 ----
  let pmId: string | null = null;
  let ownerName = user.name ?? user.email ?? "";
  let admin: AdminPick | null = null;
  if (writer) {
    pmId = user.id;
  } else {
    const teamScope = user.role === "ADMIN" ? { teamId: user.teamId ?? "__none__" } : {};
    const [parts, pms] = await Promise.all([
      prisma.part.findMany({ where: teamScope, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
      prisma.user.findMany({
        where: { role: "PM", status: "ACTIVE", ...teamScope },
        orderBy: { name: "asc" },
        select: { id: true, name: true, email: true, partId: true },
      }),
    ]);
    const partId = parts.some((p) => p.id === sp.part) ? (sp.part as string) : "";
    const inPart = pms.filter((p) => !partId || p.partId === partId);
    const picked = inPart.find((p) => p.id === sp.pm) ?? inPart[0] ?? null;
    pmId = picked?.id ?? null;
    ownerName = picked ? picked.name ?? picked.email : "";
    admin = {
      parts,
      pms: pms.map((p) => ({ id: p.id, name: p.name ?? p.email, partId: p.partId })),
      partId,
      pmId: pmId ?? "",
    };
  }

  const data = pmId
    ? await loadWeeklyBatch(ctx, { pmId, weekStart: week, prevWeekStart: prevWeek(week), weeks: weekKeys })
    : { clients: [], other: null, weekStatus: {} as Record<string, number> };

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
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">주간 공유</h1>
        {!writer && (
          <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-700">관리자 · 조회 전용</span>
        )}
      </div>
      <WeeklyTabs tabs={WEEKLY_TABS} current="batch" />
      <WeeklyFilter ym={ym} minYm={minYm} maxYm={maxYm} weeks={chips} selectedWeek={week} admin={admin} />
      {pmId ? (
        <WeeklyBatch
          key={`${pmId}|${week}|${ym.year}-${ym.month}`}
          weekStart={week}
          year={ym.year}
          month={ym.month}
          readOnly={!writer}
          ownerName={ownerName}
          clients={data.clients}
          other={data.other}
        />
      ) : (
        <p className="rounded-[14px] border border-dashed border-[var(--color-border)] p-8 text-center text-[var(--color-muted)]">
          조회할 수 있는 PM이 없습니다.
        </p>
      )}
    </div>
  );
}
