export type ClientRow = {
  id: string;
  name: string;
  pmLabel: string;
  industry: string | null;
  performance: number;
  expense: number;
  contract: number;
};

export type SortMode = "name" | "pm" | "industry";

export const PAGE_SIZE = 10;

// 청구·보고 주기 선택지(표준 순서). 카드/폼/검증이 공유한다.
export const CYCLE_VALUES = ["월", "분기", "중간", "최종"] as const;
export type CycleValue = (typeof CYCLE_VALUES)[number];

// 선택된 주기를 표준 순서로 정렬해 "·"로 결합. 미선택이면 "미설정".
export function formatCycle(values: string[]): string {
  const ordered = CYCLE_VALUES.filter((v) => values.includes(v));
  return ordered.length ? ordered.join("·") : "미설정";
}

export function filterClients<T extends { name: string; pmLabel: string; industry: string | null }>(rows: T[], query: string, mode: SortMode = "name"): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows];
  if (mode === "pm") return rows.filter((r) => r.pmLabel.toLowerCase().includes(q));
  if (mode === "industry") return rows.filter((r) => (r.industry ?? "").toLowerCase().includes(q));
  return rows.filter((r) => r.name.toLowerCase().includes(q));
}

function groupCmp(a: string | null, b: string | null, isUnassigned: (v: string | null) => boolean): number {
  const ua = isUnassigned(a);
  const ub = isUnassigned(b);
  if (ua !== ub) return ua ? 1 : -1; // 미배정/미분류는 뒤로
  if (ua && ub) return 0;
  const av = a ?? "";
  const bv = b ?? "";
  // 코드포인트 비교(의도적으로 localeCompare "ko" 아님): 완성형 한글(U+AC00~)은 코드포인트
  // 순서가 가나다 순과 일치하고, 라틴 라벨(예: "IT")은 한글보다 앞선다. localeCompare("ko")는
  // 한글을 라틴보다 앞에 두어 의도한 순서와 어긋난다. 이름 tiebreak은 byName에서 localeCompare 사용.
  return av < bv ? -1 : av > bv ? 1 : 0;
}

export function sortClients<T extends { name: string; pmLabel: string; industry: string | null }>(
  rows: T[],
  mode: SortMode,
): T[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, "ko");
  const copy = [...rows];
  if (mode === "pm") {
    return copy.sort((a, b) => groupCmp(a.pmLabel, b.pmLabel, (v) => v === "미배정") || byName(a, b));
  }
  if (mode === "industry") {
    return copy.sort((a, b) => groupCmp(a.industry, b.industry, (v) => v === null || v.trim() === "") || byName(a, b));
  }
  return copy.sort(byName);
}

export function paginate<T>(rows: T[], page: number, size = PAGE_SIZE): { pageRows: T[]; totalPages: number; page: number } {
  const totalPages = Math.max(1, Math.ceil(rows.length / size));
  const clamped = Math.min(Math.max(1, page), totalPages);
  const start = (clamped - 1) * size;
  return { pageRows: rows.slice(start, start + size), totalPages, page: clamped };
}
