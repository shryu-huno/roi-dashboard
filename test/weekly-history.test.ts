import { describe, it, expect } from "vitest";
import {
  historyWeeks, buildHistoryRows, historyText,
  type HistoryOther, type HistoryShare,
} from "@/lib/weekly-history";
import type { WeeklyShareView } from "@/lib/data/weekly-share";

const CUR = "2026-11-01"; // 이번 주(일요일)

describe("historyWeeks — 조회 기간에 해당하는 주(오래된 순, 이번 주까지)", () => {
  it("월별: 그 달과 하루라도 겹치는 주(걸친 주는 두 달 모두)", () => {
    expect(historyWeeks({ mode: "month", ym: { year: 2026, month: 10 }, curWeek: CUR })).toEqual([
      "2026-09-27", "2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25",
    ]);
    // 11월: 11/29 주는 아직 오지 않아 제외
    expect(historyWeeks({ mode: "month", ym: { year: 2026, month: 11 }, curWeek: CUR })).toEqual(["2026-11-01"]);
  });
  it("월별 12월 조회에는 11/29 주가 포함된다(걸친 주). 단 이번 주 이후는 제외", () => {
    expect(historyWeeks({ mode: "month", ym: { year: 2026, month: 12 }, curWeek: "2026-12-06" })).toContain("2026-11-29");
  });
  it("전체: 가장 이른 기록 주부터 이번 주까지, 기록이 없으면 이번 주만", () => {
    expect(historyWeeks({ mode: "all", earliestWeek: "2026-10-18", curWeek: CUR })).toEqual([
      "2026-10-18", "2026-10-25", "2026-11-01",
    ]);
    expect(historyWeeks({ mode: "all", earliestWeek: null, curWeek: CUR })).toEqual([CUR]);
  });
  it("기간 설정: 시작일~종료일과 하루라도 겹치는 주, 시작이 종료보다 늦으면 빈 목록", () => {
    expect(historyWeeks({ mode: "range", from: "2026-10-14", to: "2026-10-20", curWeek: CUR })).toEqual([
      "2026-10-11", "2026-10-18",
    ]);
    expect(historyWeeks({ mode: "range", from: "2026-10-20", to: "2026-10-14", curWeek: CUR })).toEqual([]);
  });
  it("기간 설정의 시작일이 터무니없이 옛날이어도 주 수가 제한된다(가장 이른 기록 주 / 2000년 이후)", () => {
    const withEarliest = historyWeeks({ mode: "range", from: "0100-01-01", to: "", earliestWeek: "2026-10-18", curWeek: CUR });
    expect(withEarliest).toEqual(["2026-10-18", "2026-10-25", "2026-11-01"]);
    const noRecords = historyWeeks({ mode: "range", from: "0100-01-01", to: "", curWeek: CUR });
    expect(noRecords[0]).toBe("2000-01-02");
    expect(noRecords.length).toBeLessThan(2000);
  });
  it("기간 설정에서 한쪽이 비어 있으면 그쪽은 제한하지 않는다(이번 주까지)", () => {
    expect(historyWeeks({ mode: "range", from: "2026-10-20", to: "", curWeek: CUR })).toEqual([
      "2026-10-18", "2026-10-25", "2026-11-01",
    ]);
  });
});

const view = (over: Partial<WeeklyShareView> = {}): WeeklyShareView => ({
  version: 1, thisWeek: "이번", nextWeek: "다음", note: "", noSpecial: false,
  createdByName: "김서연", updatedByName: "김서연",
  createdAt: "2026-11-03T01:34:00Z", updatedAt: "2026-11-03T01:34:00Z", editedAt: null, ...over,
});
// 기록은 작성자별 1건. authorId 기본값은 p1(김서연).
const share = (clientId: string, weekStart: string, over: Partial<WeeklyShareView> = {}, authorId = "p1"): HistoryShare => ({
  ...view(over), clientId, weekStart, authorId,
});
const other = (authorId: string, weekStart: string, text = "TF 회의"): HistoryOther => ({
  tags: ["TF"], thisWeek: text, nextWeek: "", note: "", createdAt: "2026-11-03T01:34:00Z", updatedAt: "2026-11-03T01:34:00Z", editedAt: null,
  authorId, weekStart,
});

const pms = [
  { id: "p1", name: "김서연", partName: "1파트" },
  { id: "p2", name: "이승준", partName: "1파트" },
  { id: "p3", name: "박도윤", partName: "2파트" },
];
const clientsByPm = {
  p1: [{ id: "cB", name: "B사" }, { id: "cA", name: "A사" }], // 이름 정렬은 호출 쪽 책임이 아니라 빌더가 한다
  p2: [{ id: "cB", name: "B사" }], // B사는 p1·p2 공동 담당
  p3: [{ id: "cC", name: "C사" }],
};
const base = {
  pms, clientsByPm, shares: [] as HistoryShare[], others: [] as HistoryOther[],
  weeks: ["2026-10-25", "2026-11-01"], clientFilter: "", showMissing: false, query: "",
};

describe("buildHistoryRows — 파트 > PM > 고객사 > 주차(최신순)", () => {
  it("PM 순서, 고객사 이름순, 주차 최신순으로 정렬한다", () => {
    const rows = buildHistoryRows({
      ...base,
      shares: [
        share("cA", "2026-10-25"), share("cA", "2026-11-01"), share("cB", "2026-11-01"),
        share("cB", "2026-11-01", { createdByName: "이승준" }, "p2"), share("cC", "2026-11-01", {}, "p3"),
      ],
    });
    expect(rows.map((r) => (r.kind === "client" ? `${r.pmId}/${r.clientName}/${r.weekStart}` : "other"))).toEqual([
      "p1/A사/2026-11-01", "p1/A사/2026-10-25", "p1/B사/2026-11-01",
      "p2/B사/2026-11-01", // 공동 담당 고객사: 각자 쓴 기록이 각자 아래에 나온다
      "p3/C사/2026-11-01",
    ]);
  });

  it("기타 업무는 그 PM의 고객사 줄 뒤에 붙는다", () => {
    const rows = buildHistoryRows({ ...base, shares: [share("cA", "2026-11-01")], others: [other("p1", "2026-11-01"), other("p3", "2026-10-25")] });
    expect(rows.map((r) => `${r.pmId}:${r.kind}`)).toEqual(["p1:client", "p1:other", "p3:other"]);
  });

  it("미작성 주차는 켰을 때만 빈 행으로 나온다", () => {
    const s = [share("cA", "2026-11-01")];
    expect(buildHistoryRows({ ...base, shares: s }).filter((r) => r.kind === "client" && !r.share)).toHaveLength(0);
    const rows = buildHistoryRows({ ...base, shares: s, showMissing: true });
    const missing = rows.filter((r) => r.kind === "client" && !r.share);
    // p1: A사 10/25, B사 10/25·11/1 / p2: B사 10/25·11/1 / p3: C사 10/25·11/1
    expect(missing).toHaveLength(7);
  });

  it("PM 아래에는 그 PM이 쓴 기록만 나온다(공동 담당자가 쓴 기록은 나오지 않는다)", () => {
    const rows = buildHistoryRows({ ...base, shares: [share("cB", "2026-11-01", { thisWeek: "p1의 일지" })] });
    expect(rows.map((r) => (r.kind === "client" ? `${r.pmId}/${r.clientName}` : "other"))).toEqual(["p1/B사"]);
    const row = rows[0];
    expect(row.kind === "client" && row.authorId).toBe("p1");
  });

  it("공동 담당자 한 명이라도 썼으면 안 쓴 담당자 아래에 미작성 행을 만들지 않는다", () => {
    const rows = buildHistoryRows({
      ...base, weeks: ["2026-11-01"], showMissing: true,
      shares: [share("cA", "2026-11-01"), share("cB", "2026-11-01"), share("cC", "2026-11-01", {}, "p3")], // B사는 p1만 씀
    });
    expect(rows.filter((r) => r.kind === "client" && !r.share)).toHaveLength(0); // p2의 B사 행도 미작성이 아니다
    expect(rows.filter((r) => r.kind === "client" && r.clientId === "cB").map((r) => r.pmId)).toEqual(["p1"]);
  });

  it("검색어가 있으면 내용·고객사·구분이 맞는 기록만 남고 미작성 행은 숨긴다", () => {
    const rows = buildHistoryRows({
      ...base, showMissing: true, query: "보고서",
      shares: [share("cA", "2026-11-01", { thisWeek: "분기 보고서 정리" }), share("cC", "2026-11-01", { thisWeek: "미팅" }, "p3")],
    });
    expect(rows.map((r) => (r.kind === "client" ? r.clientName : ""))).toEqual(["A사"]);
    const byName = buildHistoryRows({ ...base, query: "c사", shares: [share("cC", "2026-11-01", {}, "p3")] });
    expect(byName).toHaveLength(1);
    const byTag = buildHistoryRows({ ...base, query: "tf", others: [other("p1", "2026-11-01")] });
    expect(byTag).toHaveLength(1);
  });

  it("고객사 하나를 고르면 같은 주의 공동 담당자 기록이 작성자 이름순으로 나란히 보인다", () => {
    const rows = buildHistoryRows({
      ...base, clientFilter: "cB",
      shares: [
        share("cB", "2026-11-01", { createdByName: "이승준", thisWeek: "p2 내용" }, "p2"),
        share("cB", "2026-11-01", { createdByName: "김서연", thisWeek: "p1 내용" }, "p1"),
      ],
    });
    const got = rows.map((r) => (r.kind === "client" ? `${r.weekStart}/${r.share?.createdByName ?? "미작성"}/${r.authorId}` : ""));
    expect(got).toEqual(["2026-11-01/김서연/p1", "2026-11-01/이승준/p2", "2026-10-25/미작성/null"]);
  });

  it("고객사 하나를 고르면 PM 구분 없이 그 고객사의 주차만(미작성 주차 포함) 최신순으로 보인다", () => {
    const rows = buildHistoryRows({ ...base, clientFilter: "cB", shares: [share("cB", "2026-11-01")] });
    expect(rows.map((r) => `${r.pmId}/${r.kind === "client" ? r.weekStart : ""}/${r.kind === "client" && !!r.share}`)).toEqual([
      "null/2026-11-01/true", "null/2026-10-25/false",
    ]);
  });

  it("'기타 업무'만 고르면 기타 업무 행만 보인다", () => {
    const rows = buildHistoryRows({
      ...base, clientFilter: "other", shares: [share("cA", "2026-11-01")], others: [other("p1", "2026-11-01")],
    });
    expect(rows.map((r) => r.kind)).toEqual(["other"]);
  });
});

describe("historyText — 복사용 텍스트", () => {
  it("주차는 구역 제목에 한 번만, 파트·PM·고객사 순 들여쓰기, 이번주/다음주(줄바꿈은 ' / '), 작성자·시간·주차 줄은 없다", () => {
    const rows = buildHistoryRows({
      ...base, weeks: ["2026-11-01"],
      shares: [share("cA", "2026-11-01", { thisWeek: "상담 5건\n보고서 정리", nextWeek: "상담 6건", note: "일정 조정" })],
      others: [other("p1", "2026-11-01", "TF 회의")],
    });
    const text = historyText(rows, { scope: "PM 3명", rangeLabel: "2026년 11월", grouped: true });
    expect(text).toContain("[주간공유] PM 3명 · 2026년 11월");
    expect(text).toContain("■ 2026년 11월 1주차");
    expect(text.match(/11월 1주차/g)).toHaveLength(1); // 고객사마다 주차를 되풀이하지 않는다
    expect(text).toContain("[1파트]");
    expect(text).toContain("● 김서연");
    expect(text).toContain("▸ A사");
    expect(text).toContain("- 이번주: 상담 5건 / 보고서 정리");
    expect(text).toContain("다음주: 상담 6건");
    expect(text).toContain("비고: 일정 조정");
    expect(text).toContain("▸ 기타 업무 [TF]");
    expect(text).not.toContain("작성:");
    expect(text).not.toContain("11/3(화)");
  });
  it("특이사항 없음은 '- 특이사항 없음' 한 줄, 미작성 행은 복사에서 뺀다", () => {
    const rows = buildHistoryRows({
      ...base, weeks: ["2026-11-01"], showMissing: true,
      shares: [share("cA", "2026-11-01", { noSpecial: true, thisWeek: "", nextWeek: "" })],
    });
    const text = historyText(rows, { scope: "내 고객사 전체", rangeLabel: "전체 기간", grouped: false });
    expect(text).toContain("▸ A사\n    - 특이사항 없음\n");
    expect(text).not.toContain("미작성");
    expect(text).not.toContain("B사");
    expect(text).not.toContain("주차:");
  });
  it("여러 주가 섞이면 주차별 구역으로 나누고 최신 주가 위, 각 구역 안에서 파트·PM을 다시 묶는다", () => {
    const rows = buildHistoryRows({
      ...base, weeks: ["2026-10-25", "2026-11-01"],
      shares: [
        share("cA", "2026-10-25", { thisWeek: "지난주 일" }),
        share("cA", "2026-11-01", { thisWeek: "이번주 일" }),
      ],
    });
    const text = historyText(rows, { scope: "PM 3명", rangeLabel: "2026년 10~11월", grouped: true });
    const iNew = text.indexOf("■ 2026년 11월 1주차");
    const iOld = text.indexOf("■ 2026년 10월 4주차");
    expect(iNew).toBeGreaterThan(-1);
    expect(iOld).toBeGreaterThan(iNew);
    expect(text.slice(iNew, iOld)).toContain("이번주 일");
    expect(text.slice(iOld)).toContain("지난주 일");
    expect(text.slice(iOld)).toContain("[1파트]"); // 구역마다 파트가 다시 나온다
  });
  it("고객사 하나만 볼 때 같은 주에 작성자가 여러 명이면 작성자별로 줄을 나눈다", () => {
    const rows = buildHistoryRows({
      ...base, clientFilter: "cB", weeks: ["2026-11-01"],
      shares: [
        share("cB", "2026-11-01", { createdByName: "김서연", thisWeek: "p1 내용" }, "p1"),
        share("cB", "2026-11-01", { createdByName: "이승준", thisWeek: "p2 내용" }, "p2"),
      ],
    });
    const text = historyText(rows, { scope: "B사", rangeLabel: "2026년 11월", grouped: false, single: true });
    expect(text).toContain("▸ 김서연\n    - 이번주: p1 내용");
    expect(text).toContain("▸ 이승준\n    - 이번주: p2 내용");
  });
  it("고객사 하나만 볼 때는 고객사 줄 없이 주차 구역 아래 바로 내용", () => {
    const rows = buildHistoryRows({ ...base, clientFilter: "cA", weeks: ["2026-11-01"], shares: [share("cA", "2026-11-01", { thisWeek: "내용" })] });
    const text = historyText(rows, { scope: "A사", rangeLabel: "2026년 11월", grouped: false, single: true });
    expect(text).toContain("■ 2026년 11월 1주차\n- 이번주: 내용");
    expect(text).not.toContain("▸");
  });
});
