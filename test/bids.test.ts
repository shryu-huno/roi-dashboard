import { describe, it, expect } from "vitest";
import {
  BID_STATUS_LABEL, bidStats, daysUntil, ddayBadge, filterByStatus, formatBidDate, isLive, scopeBids, sortBids,
  type BidView,
} from "@/lib/bids";

const TODAY = "2026-11-05";
const bid = (over: Partial<BidView> = {}): BidView => ({
  id: "b", orgName: "세움도시공사", title: "2027년 EAP 운영 용역", kind: "NEW", amount: 100_000_000,
  dueDate: "2026-11-12", announceDate: "2026-11-26", status: "PREPARING", note: "", ...over,
});

describe("상태·D-day", () => {
  it("상태 라벨 5종, 진행 중은 준비중·심사중", () => {
    expect(Object.values(BID_STATUS_LABEL)).toEqual(["준비중", "심사중", "수주", "실주", "유찰"]);
    expect(isLive("PREPARING")).toBe(true);
    expect(isLive("REVIEWING")).toBe(true);
    expect(["WON", "LOST", "FAILED"].some((s) => isLive(s as never))).toBe(false);
  });
  it("daysUntil: 오늘 기준 남은 일수(음수면 지남)", () => {
    expect(daysUntil("2026-11-12", TODAY)).toBe(7);
    expect(daysUntil(TODAY, TODAY)).toBe(0);
    expect(daysUntil("2026-11-01", TODAY)).toBe(-4);
    expect(daysUntil("2027-01-01", "2026-12-31")).toBe(1); // 해를 넘어도
  });
  it("ddayBadge: 준비중은 제출 마감, 심사중은 결과 발표 기준. 14일 이내만, 3일 이내는 긴급", () => {
    expect(ddayBadge(bid({ dueDate: "2026-11-12" }), TODAY)).toEqual({ label: "D-7", urgent: false });
    expect(ddayBadge(bid({ dueDate: "2026-11-07" }), TODAY)).toEqual({ label: "D-2", urgent: true });
    expect(ddayBadge(bid({ dueDate: TODAY }), TODAY)).toEqual({ label: "D-day", urgent: true });
    expect(ddayBadge(bid({ dueDate: "2026-11-19" }), TODAY)).toEqual({ label: "D-14", urgent: false });
    expect(ddayBadge(bid({ dueDate: "2026-11-20" }), TODAY)).toBeNull(); // 15일 이상
    expect(ddayBadge(bid({ dueDate: "2026-11-01" }), TODAY)).toBeNull(); // 지남
    expect(ddayBadge(bid({ status: "REVIEWING", dueDate: "2026-10-01", announceDate: "2026-11-08" }), TODAY)).toEqual({ label: "D-3", urgent: true });
  });
  it("ddayBadge: 수주·실주·유찰은 D-day를 보이지 않는다", () => {
    for (const status of ["WON", "LOST", "FAILED"] as const) expect(ddayBadge(bid({ status, dueDate: "2026-11-07" }), TODAY)).toBeNull();
  });
});

describe("sortBids — 진행 중 먼저(제출 마감 임박순), 나머지는 결과 발표 최신순", () => {
  it("정렬", () => {
    const sorted = sortBids([
      bid({ id: "won-old", status: "WON", announceDate: "2026-09-01" }),
      bid({ id: "live-late", dueDate: "2026-12-01" }),
      bid({ id: "lost-new", status: "LOST", announceDate: "2026-10-30" }),
      bid({ id: "live-soon", status: "REVIEWING", dueDate: "2026-10-20" }),
    ]);
    expect(sorted.map((b) => b.id)).toEqual(["live-soon", "live-late", "lost-new", "won-old"]);
  });
  it("원본 배열을 바꾸지 않는다", () => {
    const src = [bid({ id: "a", status: "WON" }), bid({ id: "b" })];
    sortBids(src);
    expect(src.map((b) => b.id)).toEqual(["a", "b"]);
  });
});

describe("scopeBids / filterByStatus", () => {
  const all = [
    bid({ id: "1", orgName: "한빛에너지공단", title: "EAP 운영", dueDate: "2026-11-09", note: "현 계약 12월 종료" }),
    bid({ id: "2", orgName: "큰빛병원", title: "소진 예방 상담", dueDate: "2026-12-03", status: "WON" }),
    bid({ id: "3", orgName: "푸른바다연구원", title: "심리지원", dueDate: "2026-11-27", status: "LOST" }),
    bid({ id: "4", orgName: "해밀과학재단", title: "연구자 상담", dueDate: "2026-11-02", status: "FAILED" }),
  ];
  it("제출 마감 월로 거른다(없으면 전체)", () => {
    expect(scopeBids(all, { ym: { year: 2026, month: 11 }, q: "" }).map((b) => b.id)).toEqual(["1", "3", "4"]);
    expect(scopeBids(all, { ym: null, q: "" })).toHaveLength(4);
  });
  it("발주처·사업명·비고에서 검색한다(대소문자 무시, 공백 제거)", () => {
    expect(scopeBids(all, { ym: null, q: " 병원 " }).map((b) => b.id)).toEqual(["2"]);
    expect(scopeBids(all, { ym: null, q: "12월 종료" }).map((b) => b.id)).toEqual(["1"]);
    expect(scopeBids(all, { ym: null, q: "eap" }).map((b) => b.id)).toEqual(["1"]);
  });
  it("상태 필터: 진행 중 / 수주 / 실주·유찰 / 전체", () => {
    expect(filterByStatus(all, "live").map((b) => b.id)).toEqual(["1"]);
    expect(filterByStatus(all, "won").map((b) => b.id)).toEqual(["2"]);
    expect(filterByStatus(all, "closed").map((b) => b.id)).toEqual(["3", "4"]);
    expect(filterByStatus(all, "all")).toHaveLength(4);
  });
});

describe("bidStats — 진행 중·수주·수주율·가장 가까운 제출 마감", () => {
  it("건수·금액, 수주율은 수주÷(수주+실주)로 유찰은 제외", () => {
    const s = bidStats(
      [
        bid({ id: "a", amount: 100, status: "PREPARING" }),
        bid({ id: "b", amount: 50, status: "REVIEWING" }),
        bid({ id: "c", amount: 300, status: "WON" }),
        bid({ id: "d", amount: 700, status: "WON" }),
        bid({ id: "e", amount: 10, status: "LOST" }),
        bid({ id: "f", amount: 999, status: "FAILED" }),
      ],
      TODAY,
    );
    expect(s.live).toEqual({ count: 2, amount: 150 });
    expect(s.won).toEqual({ count: 2, amount: 1000 });
    expect(s.decided).toBe(3); // 수주 2 + 실주 1
    expect(s.rate).toBeCloseTo(2 / 3);
  });
  it("결과가 난 입찰이 없으면 수주율은 null", () => {
    expect(bidStats([bid({ status: "PREPARING" }), bid({ status: "FAILED" })], TODAY).rate).toBeNull();
    expect(bidStats([], TODAY).rate).toBeNull();
  });
  it("가장 가까운 제출 마감: 준비중이고 마감이 오늘 이후인 것 중 가장 이른 것", () => {
    const s = bidStats(
      [
        bid({ id: "past", dueDate: "2026-11-01" }), // 지남
        bid({ id: "far", dueDate: "2026-12-10" }),
        bid({ id: "near", dueDate: "2026-11-06" }),
        bid({ id: "review", status: "REVIEWING", dueDate: "2026-11-05" }), // 심사중은 제외
      ],
      TODAY,
    );
    expect(s.next?.id).toBe("near");
    expect(bidStats([bid({ status: "WON" })], TODAY).next).toBeNull();
  });
});

describe("formatBidDate — 목록의 날짜 표기", () => {
  it("'월/일(요일)'", () => {
    expect(formatBidDate("2026-11-12")).toBe("11/12(목)");
    expect(formatBidDate("2026-01-04")).toBe("1/4(일)");
    expect(formatBidDate("2026-12-05")).toBe("12/5(토)");
  });
});
