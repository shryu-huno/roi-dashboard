// 월 단위 기간(시작~종료) 표현/파싱 유틸. 전체 내역 조회 필터와 상세 페이지가 공유한다.
export type Ym = { year: number; month: number };

// "YYYY-MM"(예: <input type="month"> 값) 파싱. 형식/범위가 어긋나면 null.
export function parseYm(v: string | undefined): Ym | null {
  const m = /^(\d{4})-(\d{2})$/.exec(v ?? "");
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

// Ym → "YYYY-MM" (input[type=month] value / 쿼리 파라미터용).
export function ymValue(ym: Ym): string {
  return `${ym.year}-${String(ym.month).padStart(2, "0")}`;
}

// 두 시점을 시작<=종료로 정렬해서 반환.
export function orderRange(a: Ym, b: Ym): [Ym, Ym] {
  return a.year * 12 + a.month <= b.year * 12 + b.month ? [a, b] : [b, a];
}

// 사람이 읽는 기간 라벨. 같은 달이면 단일 달로 표시.
export function rangeLabel(from: Ym, to: Ym): string {
  const f = `${from.year}년 ${from.month}월`;
  if (from.year === to.year && from.month === to.month) return f;
  return `${f} ~ ${to.year}년 ${to.month}월`;
}

// [from, to] 구간의 각 달을 순서대로 나열.
export function eachMonth(from: Ym, to: Ym): Ym[] {
  const out: Ym[] = [];
  for (let v = from.year * 12 + (from.month - 1); v <= to.year * 12 + (to.month - 1); v++) {
    out.push({ year: Math.floor(v / 12), month: (v % 12) + 1 });
  }
  return out;
}
