// 주간 공유의 "주" 계산. 주는 일요일~토요일이고, 주의 키는 그 주 일요일 날짜("YYYY-MM-DD")다.
// 키를 문자열 날짜로만 다뤄 시간대(UTC/KST) 어긋남을 피하고, DB의 @db.Date 컬럼과 그대로 대응시킨다.

export type WeekKey = string; // 그 주 일요일, "YYYY-MM-DD"

const DAY_MS = 24 * 60 * 60 * 1000;

function toUtc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtc(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function addDays(ymd: string, n: number): string {
  return fromUtc(new Date(toUtc(ymd).getTime() + n * DAY_MS));
}

/** 임의의 날짜가 속한 주의 키(그 주 일요일). */
export function weekStartOf(ymd: string): WeekKey {
  return addDays(ymd, -toUtc(ymd).getUTCDay());
}

export function addWeeks(key: WeekKey, n: number): WeekKey {
  return addDays(key, n * 7);
}

export function prevWeek(key: WeekKey): WeekKey {
  return addWeeks(key, -1);
}

/** 그 주 토요일. */
export function weekEnd(key: WeekKey): string {
  return addDays(key, 6);
}

/** 저장 가능한 주 키인지: 형식이 맞고 실제 존재하는 일요일 날짜. */
export function isWeekStart(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = toUtc(s);
  return fromUtc(d) === s && d.getUTCDay() === 0;
}

/** 그 달과 하루라도 겹치는 주 전부. 두 달에 걸친 주는 양쪽 달에 모두 나온다. */
export function weeksOverlappingMonth(year: number, month: number): WeekKey[] {
  const first = fromUtc(new Date(Date.UTC(year, month - 1, 1)));
  const last = fromUtc(new Date(Date.UTC(year, month, 0)));
  const out: WeekKey[] = [];
  for (let k = weekStartOf(first); k <= last; k = addWeeks(k, 1)) out.push(k);
  return out;
}

// 주의 소속 월(라벨·월별 묶음용): 4일 이상 걸친 달. 일~토 7일 중 가운데 날(수요일)이 속한 달과 같다.
function midweek(key: WeekKey): string {
  return addDays(key, 3);
}

export function weekMonth(key: WeekKey): { year: number; month: number } {
  const [y, m] = midweek(key).split("-").map(Number);
  return { year: y, month: m };
}

/** "11월 1주차" — 소속 월 기준, 그 달 안에서 7일 단위 순번. */
export function weekLabel(key: WeekKey): string {
  const [, m, d] = midweek(key).split("-").map(Number);
  return `${m}월 ${Math.floor((d - 1) / 7) + 1}주차`;
}

/** "11/1–11/7" */
export function weekRange(key: WeekKey): string {
  const md = (ymd: string) => {
    const [, m, d] = ymd.split("-").map(Number);
    return `${m}/${d}`;
  };
  return `${md(key)}–${md(weekEnd(key))}`;
}

/** 한국 시간(Asia/Seoul) 기준 오늘 "YYYY-MM-DD". 서버가 UTC로 돌아도 한국 날짜를 쓴다. */
export function kstToday(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

/** 한국 시간 기준 이번 주 키. */
export function currentWeek(now: Date = new Date()): WeekKey {
  return weekStartOf(kstToday(now));
}

/** "11/3(화) 10:34" — 한국 시간 기준 작성·수정 시각 표기(서버·브라우저 어디서 만들어도 같은 문자열). */
export function formatKstDateTime(d: Date | string): string {
  const t = typeof d === "string" ? new Date(d) : d;
  const k = new Date(t.getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()}(${"일월화수목금토"[k.getUTCDay()]}) ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}
