// 입찰·수주의 순수 로직: 상태, D-day, 정렬, 필터, 통계. DB를 읽는 일은 data/bids.ts가 맡는다.
// 날짜는 "YYYY-MM-DD" 문자열로만 다룬다(시간대 어긋남 방지).
import type { Ym } from "@/lib/month-range";

export const BID_STATUSES = ["PREPARING", "REVIEWING", "WON", "LOST", "FAILED"] as const;
export const BID_KINDS = ["NEW", "RENEWAL"] as const;
export type BidStatus = (typeof BID_STATUSES)[number];
export type BidKind = (typeof BID_KINDS)[number];

export const BID_STATUS_LABEL: Record<BidStatus, string> = {
  PREPARING: "준비중",
  REVIEWING: "심사중",
  WON: "수주",
  LOST: "실주",
  FAILED: "유찰",
};
export const BID_KIND_LABEL: Record<BidKind, string> = { NEW: "신규", RENEWAL: "갱신" };

export type BidView = {
  id: string;
  orgName: string; // 발주처
  title: string; // 사업명
  kind: BidKind;
  amount: number; // 입찰 금액(원)
  dueDate: string; // 제출 마감일
  announceDate: string; // 결과 발표일
  status: BidStatus;
  note: string;
};

/** "YYYY-MM-DD" 형식이면서 실제 존재하는 날짜인지. */
export function isValidYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** 진행 중(준비중·심사중). */
export const isLive = (s: BidStatus) => s === "PREPARING" || s === "REVIEWING";

const utc = (ymd: string) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));

/** date까지 남은 일수(today 기준, 지났으면 음수). */
export function daysUntil(date: string, today: string): number {
  return Math.round((utc(date) - utc(today)) / 86_400_000);
}

/**
 * D-day 배지: 준비중은 제출 마감일, 심사중은 결과 발표일까지. 0~14일 남았을 때만 보이고 3일 이내는 긴급.
 * 수주·실주·유찰은 일정이 끝났으므로 없다.
 */
export function ddayBadge(b: BidView, today: string): { label: string; urgent: boolean } | null {
  const target = b.status === "PREPARING" ? b.dueDate : b.status === "REVIEWING" ? b.announceDate : null;
  if (!target) return null;
  const n = daysUntil(target, today);
  if (n < 0 || n > 14) return null;
  return { label: n === 0 ? "D-day" : `D-${n}`, urgent: n <= 3 };
}

/** 진행 중이 먼저(제출 마감 임박순), 그 뒤는 결과 발표가 최근인 순. 원본은 바꾸지 않는다. */
export function sortBids(bids: BidView[]): BidView[] {
  return [...bids].sort((a, b) => {
    const la = isLive(a.status);
    const lb = isLive(b.status);
    if (la !== lb) return la ? -1 : 1;
    return la ? a.dueDate.localeCompare(b.dueDate) : b.announceDate.localeCompare(a.announceDate);
  });
}

/** 기간(제출 마감 월, null이면 전체)과 검색어(발주처·사업명·비고)로 거른다. 상태 필터는 따로(통계는 이 범위 기준). */
export function scopeBids(bids: BidView[], o: { ym: Ym | null; q: string }): BidView[] {
  const q = o.q.trim().toLowerCase();
  const month = o.ym ? `${o.ym.year}-${String(o.ym.month).padStart(2, "0")}` : null;
  return bids.filter(
    (b) =>
      (!month || b.dueDate.slice(0, 7) === month) &&
      (!q || [b.orgName, b.title, b.note].join("\n").toLowerCase().includes(q)),
  );
}

export type BidStatusFilter = "all" | "live" | "won" | "closed";

export function filterByStatus(bids: BidView[], f: BidStatusFilter): BidView[] {
  if (f === "all") return bids;
  if (f === "live") return bids.filter((b) => isLive(b.status));
  if (f === "won") return bids.filter((b) => b.status === "WON");
  return bids.filter((b) => b.status === "LOST" || b.status === "FAILED");
}

/**
 * 통계: 진행 중·수주의 건수와 금액, 수주율 = 수주 ÷ (수주 + 실주)(유찰은 제외, 결과가 없으면 null),
 * 가장 가까운 제출 마감 = 준비중이면서 마감이 오늘 이후인 입찰 중 가장 이른 것.
 */
export function bidStats(scope: BidView[], today: string) {
  const sum = (list: BidView[]) => ({ count: list.length, amount: list.reduce((s, b) => s + b.amount, 0) });
  const live = scope.filter((b) => isLive(b.status));
  const won = scope.filter((b) => b.status === "WON");
  const lost = scope.filter((b) => b.status === "LOST");
  const decided = won.length + lost.length;
  const next =
    scope
      .filter((b) => b.status === "PREPARING" && daysUntil(b.dueDate, today) >= 0)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] ?? null;
  return { live: sum(live), won: sum(won), decided, rate: decided ? won.length / decided : null, next };
}

/** 목록용 날짜 표기: "11/12(목)". */
export function formatBidDate(ymd: string): string {
  const d = new Date(utc(ymd));
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${"일월화수목금토"[d.getUTCDay()]})`;
}
