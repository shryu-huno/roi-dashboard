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

export function filterClients(rows: ClientRow[], query: string): ClientRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows];
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

export function sortClients(rows: ClientRow[], mode: SortMode): ClientRow[] {
  const byName = (a: ClientRow, b: ClientRow) => a.name.localeCompare(b.name, "ko");
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
