import { describe, it, expect } from "vitest";
import {
  totalsFor, partCards, trendSeries, periodTable, directory,
  type ClientFacts, type PartStatusInput,
} from "@/lib/part-status";
import { niceMax } from "@/lib/chart-axis";

const months = (pairs: Record<number, number>) => Array.from({ length: 12 }, (_, i) => pairs[i + 1] ?? 0);

const fact = (
  id: string, name: string,
  perfTaxable: Record<number, number>, perfExempt: Record<number, number> = {},
  contractTaxable = 0, contractExempt = 0,
  fullTaxable = contractTaxable, fullExempt = contractExempt, // 계약 기간 전체 금액(기본은 올해 귀속분과 같다)
  performanceContract = false,
): ClientFacts => ({ id, name, contractTaxable, contractExempt, fullTaxable, fullExempt, performanceContract, perfTaxable: months(perfTaxable), perfExempt: months(perfExempt) });

// 1파트: PM 김(A, B) · PM 이(B 공동, C) / 2파트: PM 박(D)
const base = (includeVat: boolean): PartStatusInput => ({
  groups: [{ id: "g1", name: "1파트" }, { id: "g2", name: "2파트" }],
  pms: [
    { id: "kim", name: "김", groupId: "g1" },
    { id: "lee", name: "이", groupId: "g1" },
    { id: "park", name: "박", groupId: "g2" },
  ],
  clientsByPm: { kim: ["A", "B"], lee: ["B", "C"], park: ["D"] },
  clients: {
    A: fact("A", "A사", { 1: 1000, 2: 1000 }, {}, 4000),
    B: fact("B", "B사", { 2: 2000, 4: 1000 }, { 4: 500 }, 6000, 1000),
    C: fact("C", "C사", { 5: 3000 }, {}, 3000),
    D: fact("D", "D사", { 1: 5000 }, {}, 10000),
  },
  includeVat,
});

describe("totalsFor — 부가세는 과세분에만, 누적·계약금은 한 번만 적용", () => {
  it("부가세 미포함이면 과세+면세 원값 합", () => {
    const t = totalsFor(base(false), ["A", "B"]);
    expect(t.cumulative).toBe(1000 + 1000 + 2000 + 1000 + 500);
    expect(t.contract).toBe(4000 + 6000 + 1000);
    expect(t.months[1]).toBe(3000); // 2월: A 1000 + B 2000
    expect(t.months[3]).toBe(1500); // 4월: B 과세 1000 + 면세 500
  });
  it("부가세 포함이면 과세분만 ×1.1(10원 단위 반올림), 면세분은 원값", () => {
    const t = totalsFor(base(true), ["B"]);
    expect(t.months[3]).toBe(1100 + 500); // 4월
    expect(t.cumulative).toBe(Math.round((3000 * 1.1) / 10) * 10 + 500);
    expect(t.contract).toBe(Math.round((6000 * 1.1) / 10) * 10 + 1000);
  });
  it("달성률 = 누적 ÷ 계약금, 계약금이 0이면 null, 고객사 수를 센다", () => {
    const t = totalsFor(base(false), ["A"]);
    expect(t.rate).toBeCloseTo(2000 / 4000);
    expect(t.clientCount).toBe(1);
    expect(totalsFor(base(false), []).rate).toBeNull();
  });
  it("같은 고객사가 중복으로 들어와도 한 번만 센다", () => {
    expect(totalsFor(base(false), ["A", "A", "B", "B"]).cumulative).toBe(totalsFor(base(false), ["A", "B"]).cumulative);
  });
});

describe("partCards — 전체 카드는 고객사 기준 중복 제거, 파트 카드는 그 파트 PM의 고객사 전부", () => {
  it("전체 + 파트별 카드를 돌려준다(PM 수·고객사 수·누적·계약금·달성률·선택월 실적)", () => {
    const cards = partCards(base(false), 2);
    expect(cards.map((c) => c.name)).toEqual(["전체", "1파트", "2파트"]);
    const [all, p1, p2] = cards;
    expect(all).toMatchObject({ pmCount: 3, clientCount: 4 });
    expect(p1).toMatchObject({ pmCount: 2, clientCount: 3 }); // B는 김·이 공동 담당이지만 1파트에서 한 번
    expect(p2).toMatchObject({ pmCount: 1, clientCount: 1 });
    expect(p1.monthAmount).toBe(1000 + 2000); // 2월: A + B
    expect(p2.monthAmount).toBe(0);
    expect(all.cumulative).toBe(p1.cumulative + p2.cumulative); // 파트가 겹치지 않으면 합이 맞는다
    expect(all.rate).toBeCloseTo(all.cumulative / all.contract);
  });
  it("서로 다른 파트가 같은 고객사를 맡으면 파트 카드에는 각각 포함되고 전체는 한 번만 센다", () => {
    const input = base(false);
    input.clientsByPm.park = ["D", "A"]; // 2파트 박도 A를 맡음
    const [all, p1, p2] = partCards(input, 1);
    expect(p1.clientCount).toBe(3);
    expect(p2.clientCount).toBe(2);
    expect(all.clientCount).toBe(4);
    expect(all.cumulative).toBeLessThan(p1.cumulative + p2.cumulative);
  });
});

describe("trendSeries — 12개월 추이", () => {
  it("전체는 파트별 계열, 파트를 고르면 그 파트 한 계열", () => {
    const all = trendSeries(base(false), "all");
    expect(all.series.map((s) => s.name)).toEqual(["1파트", "2파트"]);
    expect(all.series[0].values[1]).toBe(3000); // 1파트 2월
    expect(all.series[1].values[0]).toBe(5000); // 2파트 1월
    expect(all.totals[0]).toBe(1000 + 5000);
    const one = trendSeries(base(false), "g2");
    expect(one.series.map((s) => s.name)).toEqual(["2파트"]);
  });
});

describe("periodTable — 분기별 / 최근 3개월", () => {
  it("분기별: 파트별 행, 이번 달 이후 분기는 null, 합계 행은 고객사 중복 제거", () => {
    const t = periodTable(base(false), { groupId: "all", view: "q", month: 2, lastMonth: 5 });
    expect(t.columns).toEqual(["1분기", "2분기", "3분기", "4분기"]);
    expect(t.currentIndex).toBe(0); // 2월은 1분기
    const p1 = t.rows.find((r) => r.label === "1파트")!;
    expect(p1.values).toEqual([1000 + 1000 + 2000, 1000 + 500 + 3000, null, null]); // 1Q: A1+A2+B2 / 2Q: B4(1000+500)+C5
    expect(t.total.cumulative).toBe(p1.cumulative + t.rows.find((r) => r.label === "2파트")!.cumulative);
  });
  it("분기별에서 파트를 고르면 그 파트의 PM별 행", () => {
    const t = periodTable(base(false), { groupId: "g1", view: "q", month: 2, lastMonth: 5 });
    expect(t.rows.map((r) => r.label)).toEqual(["김", "이"]);
    // 합계는 B(공동 담당)를 두 번 세지 않는다
    expect(t.total.cumulative).toBe(totalsFor(base(false), ["A", "B", "C"]).cumulative);
  });
  it("최근 3개월: 선택한 달 포함 3개 + 3개월 합계(1월이면 있는 달만)", () => {
    const t = periodTable(base(false), { groupId: "all", view: "r3", month: 4, lastMonth: 5 });
    expect(t.columns).toEqual(["2월", "3월", "4월", "3개월 합계"]);
    const p1 = t.rows.find((r) => r.label === "1파트")!;
    expect(p1.values).toEqual([3000, 0, 1500, 4500]);
    const jan = periodTable(base(false), { groupId: "all", view: "r3", month: 1, lastMonth: 5 });
    expect(jan.columns).toEqual(["1월", "3개월 합계"]);
  });
});

describe("directory — 파트별 PM 담당 고객사·계약 금액", () => {
  it("파트 > PM > 고객사(계약금) 순. 같은 파트 PM이 공동 담당하는 고객사는 '공동 담당' 행에만 한 번 나온다", () => {
    const d = directory(base(false), "all");
    const g1 = d.groups.find((g) => g.name === "1파트")!;
    expect(g1.pms.map((p) => p.name)).toEqual(["김", "이", "공동 담당"]);
    expect(g1.pms[0].clients.map((c) => c.name)).toEqual(["A사"]); // B는 김·이 공동 담당이라 PM 행에서 빠진다
    expect(g1.pms[0].contract).toBe(4000);
    expect(g1.pms[1].clients.map((c) => c.name)).toEqual(["C사"]);
    expect(g1.pms[1].contract).toBe(3000);
    const joint = g1.pms[2];
    expect(joint.jointOf).toEqual(["김", "이"]);
    expect(joint.clients.map((c) => c.name)).toEqual(["B사"]);
    expect(joint.clientCount).toBe(1);
    expect(joint.contract).toBe(6000 + 1000);
    // 행을 더하면 파트 합계와 정확히 같다(중복 없음).
    expect(g1.pms.reduce((s, p) => s + p.clientCount, 0)).toBe(g1.clientCount);
    expect(g1.pms.reduce((s, p) => s + p.contract, 0)).toBe(g1.contract);
    expect(g1.clientCount).toBe(3);
    expect(g1.contract).toBe(4000 + 7000 + 3000);
    expect(d.total).toMatchObject({ pmCount: 3, clientCount: 4, contract: 4000 + 7000 + 3000 + 10000 }); // 공동 담당 행은 인원 수에 안 센다
  });
  it("공동 담당자 조합이 다르면 행도 따로, 단독 담당 고객사는 PM 행에 그대로", () => {
    const input: PartStatusInput = {
      groups: [{ id: "g", name: "파트" }],
      pms: [{ id: "a", name: "가", groupId: "g" }, { id: "b", name: "나", groupId: "g" }, { id: "c", name: "다", groupId: "g" }],
      clientsByPm: { a: ["X", "Y", "S"], b: ["X"], c: ["Y"] },
      clients: { X: fact("X", "X사", {}, {}, 10), Y: fact("Y", "Y사", {}, {}, 20), S: fact("S", "S사", {}, {}, 30) },
      includeVat: false,
    };
    const rows = directory(input, "all").groups[0].pms;
    expect(rows.map((r) => r.name)).toEqual(["가", "나", "다", "공동 담당", "공동 담당"]);
    expect(rows[0].clients.map((c) => c.name)).toEqual(["S사"]);
    expect(rows[1].clientCount).toBe(0); // 나는 공동 담당만 있다
    expect(rows.filter((r) => r.jointOf).map((r) => [r.jointOf, r.clients.map((c) => c.name)])).toEqual([
      [["가", "나"], ["X사"]],
      [["가", "다"], ["Y사"]],
    ]);
  });
  it("다른 파트 PM과 공동 담당이면 각 파트에서는 그 파트 PM 한 명만 맡은 것으로 보인다", () => {
    const input: PartStatusInput = {
      groups: [{ id: "g1", name: "1파트" }, { id: "g2", name: "2파트" }],
      pms: [{ id: "a", name: "가", groupId: "g1" }, { id: "b", name: "나", groupId: "g2" }],
      clientsByPm: { a: ["X"], b: ["X"] },
      clients: { X: fact("X", "X사", {}, {}, 10) },
      includeVat: false,
    };
    const d = directory(input, "all");
    expect(d.groups.map((g) => g.pms.map((p) => p.name))).toEqual([["가"], ["나"]]);
    expect(d.total.clientCount).toBe(1); // 전체에서는 한 번
  });
  it("파트를 고르면 그 파트만", () => {
    const d = directory(base(false), "g2");
    expect(d.groups.map((g) => g.name)).toEqual(["2파트"]);
    expect(d.total).toMatchObject({ pmCount: 1, clientCount: 1, contract: 10000 });
  });
});

describe("directory — 계약 금액은 연 단위로 나누지 않은 전체 금액", () => {
  // E사: 2년 계약(전체 1억, 올해 귀속 5천만). 표는 전체 1억, 카드(totalsFor)는 올해 귀속분 5천만.
  const withLong = (): PartStatusInput => ({
    groups: [{ id: "g1", name: "1파트" }],
    pms: [{ id: "kim", name: "김", groupId: "g1" }],
    clientsByPm: { kim: ["E"] },
    clients: { E: fact("E", "E사", { 1: 1000 }, {}, 50_000_000, 0, 100_000_000, 0) },
    includeVat: false,
  });
  it("고객사·PM·파트·합계 모두 전체 금액", () => {
    const d = directory(withLong(), "all");
    expect(d.groups[0].pms[0].clients[0].contract).toBe(100_000_000);
    expect(d.groups[0].pms[0].contract).toBe(100_000_000);
    expect(d.groups[0].contract).toBe(100_000_000);
    expect(d.total.contract).toBe(100_000_000);
  });
  it("카드의 계약금(달성률 분모)은 올해 귀속분 그대로", () => {
    expect(totalsFor(withLong(), ["E"]).contract).toBe(50_000_000);
  });
  it("표 합계에는 카드와 맞는 올해 귀속 계약금(attributed)도 함께 준다", () => {
    const d = directory(withLong(), "all");
    expect(d.total.contract).toBe(100_000_000); // 계약 전체 금액
    expect(d.total.attributed).toBe(50_000_000); // 올해 귀속분 = 카드 "전체"의 계약
    const all = partCards(withLong(), null)[0];
    expect(d.total.attributed).toBe(all.contract);
  });
  it("부가세 포함이면 과세분에만 부가세를 얹는다", () => {
    const input = { ...withLong(), includeVat: true };
    input.clients.E = fact("E", "E사", {}, {}, 0, 0, 100_000_000, 50_000_000);
    expect(directory(input, "all").total.contract).toBe(110_000_000 + 50_000_000);
  });
});

describe("directory — 실적 계약 고객사 표시용 플래그", () => {
  it("고객사마다 실적 계약 여부를 그대로 전달한다", () => {
    const input: PartStatusInput = {
      groups: [{ id: "g1", name: "1파트" }],
      pms: [{ id: "kim", name: "김", groupId: "g1" }],
      clientsByPm: { kim: ["P", "N"] },
      clients: {
        P: fact("P", "가사(실적계약)", {}, {}, 0, 0, 0, 0, true),
        N: fact("N", "나사(일반)", {}, {}, 100, 0),
      },
      includeVat: false,
    };
    const clients = directory(input, "all").groups[0].pms[0].clients;
    expect(clients.map((c) => [c.name, c.performanceContract])).toEqual([["가사(실적계약)", true], ["나사(일반)", false]]);
  });
});

describe("담당 없음(가상 담당자) — 인원 수에는 세지 않는다", () => {
  const input = (): PartStatusInput => ({
    groups: [{ id: "g1", name: "1파트" }, { id: "unassigned", name: "담당 없음" }],
    pms: [
      { id: "kim", name: "김", groupId: "g1" },
      { id: "__unassigned", name: "담당 없음", groupId: "unassigned", virtual: true },
    ],
    clientsByPm: { kim: ["A"], __unassigned: ["B"] },
    clients: { A: fact("A", "A사", { 1: 100 }, {}, 1000), B: fact("B", "B사", { 1: 50 }, {}, 500) },
    includeVat: false,
  });
  it("전체 카드는 담당 없음 고객사까지 포함하고 담당자 수는 실제 인원만", () => {
    const [all, g1, none] = partCards(input(), null);
    expect(all).toMatchObject({ cumulative: 150, contract: 1500, clientCount: 2, pmCount: 1 });
    expect(g1).toMatchObject({ cumulative: 100, pmCount: 1 });
    expect(none).toMatchObject({ cumulative: 50, clientCount: 1, pmCount: 0 });
  });
  it("PM별 표의 합계 인원도 실제 인원만", () => {
    expect(directory(input(), "all").total).toMatchObject({ pmCount: 1, clientCount: 2 });
  });
});

describe("niceMax — 차트 축의 보기 좋은 최댓값", () => {
  it("1·2·2.5·5·10 × 10^n 중 값을 덮는 가장 작은 수", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(1)).toBe(1);
    expect(niceMax(1.4)).toBe(2);
    expect(niceMax(2.3)).toBe(2.5);
    expect(niceMax(4.1)).toBe(5);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(123_000_000)).toBe(200_000_000);
    expect(niceMax(46_000_000)).toBe(50_000_000);
  });
});

describe("월 = 전체(month가 null) — 연도 누적만 보는 기본 상태", () => {
  it("partCards: 선택 월 실적(monthAmount)이 없다(null), 누적·계약금·달성률은 그대로", () => {
    const withMonth = partCards(base(false), 2);
    const all = partCards(base(false), null);
    expect(all.every((c) => c.monthAmount === null)).toBe(true);
    expect(all.map((c) => [c.cumulative, c.contract, c.rate])).toEqual(withMonth.map((c) => [c.cumulative, c.contract, c.rate]));
  });
  it("periodTable 분기별: 강조할 분기가 없다(currentIndex -1)", () => {
    const t = periodTable(base(false), { groupId: "all", view: "q", month: null, lastMonth: 5 });
    expect(t.currentIndex).toBe(-1);
    expect(t.columns).toEqual(["1분기", "2분기", "3분기", "4분기"]);
  });
  it("periodTable 최근 3개월: 가장 최근 달(lastMonth) 기준 3개월, 강조 없음", () => {
    const t = periodTable(base(false), { groupId: "all", view: "r3", month: null, lastMonth: 5 });
    expect(t.columns).toEqual(["3월", "4월", "5월", "3개월 합계"]);
    expect(t.currentIndex).toBe(-1);
    const p1 = t.rows.find((r) => r.label === "1파트")!;
    expect(p1.values).toEqual([0, 1500, 3000, 4500]); // 3월 0 / 4월 B(1000+500) / 5월 C 3000
  });
});

describe("분기 선택 — 월별과 같은 한 해 안의 계산", () => {
  it("partCards: 분기를 고르면 그 분기 실적(quarterAmount)이 나오고 월 실적은 없다", () => {
    const cards = partCards(base(false), null, 1); // 1분기 = 1~3월
    expect(cards.every((c) => c.monthAmount === null)).toBe(true);
    const [all, p1, p2] = cards;
    expect(p1.quarterAmount).toBe(1000 + 1000 + 2000); // 1파트: A(1·2월 1000씩) + B(2월 2000)
    expect(p2.quarterAmount).toBe(5000); // 2파트: D 1월
    expect(all.quarterAmount).toBe(p1.quarterAmount! + p2.quarterAmount!);
  });
  it("partCards: 분기를 안 고르면 quarterAmount는 null, 누적·계약금·달성률은 그대로", () => {
    const plain = partCards(base(false), 2);
    const withQ = partCards(base(false), null, 2);
    expect(plain.every((c) => c.quarterAmount === null)).toBe(true);
    expect(withQ.map((c) => [c.cumulative, c.contract, c.rate])).toEqual(plain.map((c) => [c.cumulative, c.contract, c.rate]));
  });
  it("periodTable: 분기를 고르면 그 분기 열을 강조한다(currentIndex = 분기-1)", () => {
    const t = periodTable(base(false), { groupId: "all", view: "q", month: null, quarter: 3, lastMonth: 12 });
    expect(t.currentIndex).toBe(2);
  });
});
