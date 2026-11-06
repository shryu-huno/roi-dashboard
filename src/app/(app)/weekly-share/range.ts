import { prisma } from "@/lib/db";
import type { RlsContext } from "@/lib/rls";
import type { SessionUser } from "@/lib/auth/session";
import { addMonths, parseYm, type Ym } from "@/lib/month-range";
import { currentWeek, kstToday, weekMonth, type WeekKey } from "@/lib/week";
import { earliestWeekStart } from "@/lib/data/weekly-share";

const idx = (y: Ym) => y.year * 12 + y.month;

export type WeeklyRange = {
  curWeek: WeekKey;
  ym: Ym; // 선택한 달(이동 범위 안으로 맞춘 값)
  minYm: Ym;
  maxYm: Ym;
  earliestWeek: WeekKey | null; // 가장 이른 기록 주
};

/**
 * 주간 공유 탭들이 함께 쓰는 기간 계산. 월 기본값은 이번 주 소속 월이고, 이동 범위는
 * "데이터가 있는 가장 이른 달 ~ 이번 달"이되 첫 사용 때도 지난 기록을 볼 수 있게 최소 최근 3개월은 열어 둔다.
 */
export async function weeklyRange(ctx: RlsContext, rawYm: string | undefined): Promise<WeeklyRange> {
  const now = new Date();
  const curWeek = currentWeek(now);
  const curMonth = weekMonth(curWeek);
  const today = kstToday(now);
  const todayYm: Ym = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
  const maxYm = idx(curMonth) >= idx(todayYm) ? curMonth : todayYm;
  const earliestWeek = await earliestWeekStart(ctx);
  const earliestYm = earliestWeek ? weekMonth(earliestWeek) : maxYm;
  const floorYm = addMonths(maxYm, -2);
  const minYm = idx(earliestYm) < idx(floorYm) ? earliestYm : floorYm;
  const asked = parseYm(rawYm) ?? curMonth;
  const ym = idx(asked) > idx(maxYm) ? maxYm : idx(asked) < idx(minYm) ? minYm : asked;
  return { curWeek, ym, minYm, maxYm, earliestWeek };
}

export type AdminLists = {
  parts: { id: string; name: string }[];
  pms: { id: string; name: string; partId: string | null }[]; // 이름순
};

/** 관리자가 고를 수 있는 파트·PM 목록. 팀 관리자는 자기 팀 범위, 최고관리자는 전체. */
export async function loadAdminLists(user: SessionUser): Promise<AdminLists> {
  const teamScope = user.role === "ADMIN" ? { teamId: user.teamId ?? "__none__" } : {};
  const [parts, pms] = await Promise.all([
    prisma.part.findMany({ where: teamScope, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    prisma.user.findMany({
      where: { role: "PM", status: "ACTIVE", ...teamScope },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true, partId: true },
    }),
  ]);
  return { parts, pms: pms.map((p) => ({ id: p.id, name: p.name ?? p.email, partId: p.partId })) };
}
