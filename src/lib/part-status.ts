// 파트 현황의 순수 집계. 입력(고객사별 올해 월별 실적·귀속 계약금, PM→고객사, 파트→PM)만 받아
// 카드·추이·분기표·PM 담당 현황을 계산한다. DB를 읽는 일은 data/part-status.ts가 맡는다.
//
// 계산 규칙은 전체 현황(전사 대시보드)과 같다.
//  - 실적: 과세분에만 부가세(토글)를 적용하고 면세분은 원값. 월별은 월마다, 누적은 합계에 한 번 적용.
//  - 계약금: 계약기간 월수 비례로 그 해에 귀속되는 금액(관리자 달성률 분모). 과세/면세를 나눠 합산해 부가세를 한 번 적용.
//  - 달성률 = 누적 실적 ÷ 계약금.
import { attainment } from "@/lib/metrics/formulas";
import { withVatSplit } from "@/lib/vat";

export type PartGroup = { id: string; name: string }; // 파트(소속 파트가 없는 PM은 "파트 미지정" 그룹)
export type StatusPm = { id: string; name: string; groupId: string };

export type ClientFacts = {
  id: string;
  name: string;
  contractTaxable: number; // 올해에 귀속되는 계약금(기간 비례) — 과세 과업
  contractExempt: number; // 면세 과업
  perfTaxable: number[]; // 구간의 월별 실적(과세). 길이 = 구간의 달 수(한 해면 12)
  perfExempt: number[]; // 면세
};

export type PartStatusInput = {
  groups: PartGroup[];
  pms: StatusPm[];
  clientsByPm: Record<string, string[]>; // 공동 담당 고객사는 담당 PM 모두에게 들어 있다
  clients: Record<string, ClientFacts>;
  includeVat: boolean;
  monthCount?: number; // 고객사별 월 배열의 길이(조회 구간의 달 수). 기본 12(한 해)
};

export type Totals = {
  months: number[]; // 구간의 월별 실적(부가세 규칙 적용). 한 해 조회면 1~12월
  cumulative: number; // 올해 누적 실적
  contract: number; // 올해 귀속 계약금
  rate: number | null; // 달성률(계약금이 0이면 null)
  clientCount: number;
};

const ALL = "all";
const uniq = <T,>(a: T[]) => [...new Set(a)];

function pmsOf(input: PartStatusInput, groupId: string): StatusPm[] {
  return groupId === ALL ? input.pms : input.pms.filter((p) => p.groupId === groupId);
}
function clientsOfPms(input: PartStatusInput, pms: StatusPm[]): string[] {
  return uniq(pms.flatMap((p) => input.clientsByPm[p.id] ?? []));
}

/** 고객사 집합의 합계. 같은 고객사가 여러 번 들어와도 한 번만 센다. */
export function totalsFor(input: PartStatusInput, clientIds: string[]): Totals {
  const ids = uniq(clientIds).filter((id) => input.clients[id]);
  const n = input.monthCount ?? 12;
  const sum = (pick: (c: ClientFacts) => number[], i: number) => ids.reduce((s, id) => s + pick(input.clients[id])[i], 0);
  const months = Array.from({ length: n }, (_, i) => withVatSplit(sum((c) => c.perfTaxable, i), sum((c) => c.perfExempt, i), input.includeVat));
  const taxable = Array.from({ length: n }, (_, i) => sum((c) => c.perfTaxable, i)).reduce((a, b) => a + b, 0);
  const exempt = Array.from({ length: n }, (_, i) => sum((c) => c.perfExempt, i)).reduce((a, b) => a + b, 0);
  const cumulative = withVatSplit(taxable, exempt, input.includeVat);
  const contract = withVatSplit(
    ids.reduce((s, id) => s + input.clients[id].contractTaxable, 0),
    ids.reduce((s, id) => s + input.clients[id].contractExempt, 0),
    input.includeVat,
  );
  return { months, cumulative, contract, rate: attainment(cumulative, contract), clientCount: ids.length };
}

export type Card = {
  id: string;
  name: string;
  pmCount: number;
  clientCount: number;
  cumulative: number;
  contract: number;
  rate: number | null;
  monthAmount: number | null; // 선택한 달 실적(월이 "전체"면 null)
};

/** 요약 카드: 전체(고객사 기준 중복 제거) + 파트별(그 파트 PM이 담당하는 고객사 전부). month=null이면 연도 누적만(월 실적 없음). */
export function partCards(input: PartStatusInput, month: number | null): Card[] {
  const card = (id: string, name: string): Card => {
    const pms = pmsOf(input, id);
    const t = totalsFor(input, clientsOfPms(input, pms));
    return { id, name, pmCount: pms.length, clientCount: t.clientCount, cumulative: t.cumulative, contract: t.contract, rate: t.rate, monthAmount: month === null ? null : t.months[month - 1] };
  };
  return [card(ALL, "전체"), ...input.groups.map((g) => card(g.id, g.name))];
}

/** 월별 추이(한 해면 12개월, 기간 설정이면 구간의 달들): 전체면 파트별 계열(누적 막대), 파트를 고르면 그 파트 한 계열. */
export function trendSeries(input: PartStatusInput, groupId: string) {
  const groups = groupId === ALL ? input.groups : input.groups.filter((g) => g.id === groupId);
  const series = groups.map((g) => ({ id: g.id, name: g.name, values: totalsFor(input, clientsOfPms(input, pmsOf(input, g.id))).months }));
  const totals = Array.from({ length: input.monthCount ?? 12 }, (_, i) => series.reduce((s, x) => s + x.values[i], 0));
  return { series, totals };
}

export type TableRow = { id: string; label: string; values: (number | null)[]; cumulative: number; contract: number; rate: number | null };

const QUARTERS = [[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]];

/**
 * 분기별("q") / 최근 3개월("r3") 표. 전체면 파트별 행, 파트를 고르면 그 파트의 PM별 행.
 * 합계 행은 행 값을 더하지 않고 고객사를 한 번씩만 모아 다시 계산한다(공동 담당 중복 방지).
 * lastMonth: 지금 달 — 분기별에서 아직 시작하지 않은 분기는 null("—").
 * month=null(월 "전체")이면 강조할 열이 없고(currentIndex -1), 최근 3개월은 가장 최근 달(lastMonth) 기준이다.
 */
export function periodTable(
  input: PartStatusInput,
  o: { groupId: string; view: "q" | "r3"; month: number | null; lastMonth: number },
) {
  const anchor = o.month ?? o.lastMonth;
  const monthList = o.view === "r3" ? [anchor - 2, anchor - 1, anchor].filter((m) => m >= 1) : [];
  const columns =
    o.view === "q" ? QUARTERS.map((_, i) => `${i + 1}분기`) : [...monthList.map((m) => `${m}월`), "3개월 합계"];
  const currentIndex = o.month === null ? -1 : o.view === "q" ? Math.floor((o.month - 1) / 3) : monthList.length - 1;

  const valuesOf = (t: Totals): (number | null)[] => {
    if (o.view === "q") return QUARTERS.map((q) => (q[0] > o.lastMonth ? null : q.reduce((s, m) => s + t.months[m - 1], 0)));
    const vals = monthList.map((m) => t.months[m - 1]);
    return [...vals, vals.reduce((a, b) => a + b, 0)];
  };
  const row = (id: string, label: string, clientIds: string[]): TableRow => {
    const t = totalsFor(input, clientIds);
    return { id, label, values: valuesOf(t), cumulative: t.cumulative, contract: t.contract, rate: t.rate };
  };

  const rows =
    o.groupId === ALL
      ? input.groups.map((g) => row(g.id, g.name, clientsOfPms(input, pmsOf(input, g.id))))
      : pmsOf(input, o.groupId).map((p) => row(p.id, p.name, input.clientsByPm[p.id] ?? []));
  const allClients = uniq(o.groupId === ALL ? clientsOfPms(input, input.pms) : clientsOfPms(input, pmsOf(input, o.groupId)));
  return { columns, currentIndex, rows, total: row("total", "합계", allClients) };
}

export type RangeRow = { id: string; label: string; clientCount: number; cumulative: number; contract: number; rate: number | null };

/**
 * 기간 설정용 합계 표: 구간 전체의 실적·계약금(구간 귀속분)·달성률. 전체면 파트별 행, 파트를 고르면 PM별 행.
 * 합계 행은 고객사를 한 번씩만 모아 다시 계산한다(공동 담당 중복 방지).
 */
export function rangeTable(input: PartStatusInput, groupId: string): { rows: RangeRow[]; total: RangeRow } {
  const row = (id: string, label: string, clientIds: string[]): RangeRow => {
    const t = totalsFor(input, clientIds);
    return { id, label, clientCount: t.clientCount, cumulative: t.cumulative, contract: t.contract, rate: t.rate };
  };
  const rows =
    groupId === ALL
      ? input.groups.map((g) => row(g.id, g.name, clientsOfPms(input, pmsOf(input, g.id))))
      : pmsOf(input, groupId).map((p) => row(p.id, p.name, input.clientsByPm[p.id] ?? []));
  const allClients = clientsOfPms(input, groupId === ALL ? input.pms : pmsOf(input, groupId));
  return { rows, total: row("total", "합계", allClients) };
}

export type DirectoryPm = {
  id: string;
  name: string;
  clientCount: number;
  contract: number;
  clients: { id: string; name: string; contract: number }[];
};
export type DirectoryGroup = { id: string; name: string; pmCount: number; clientCount: number; contract: number; pms: DirectoryPm[] };

/** 파트별 PM 담당 고객사 수와 계약 금액(올해 귀속분). 파트 합계는 고객사를 한 번만 센다. */
export function directory(input: PartStatusInput, groupId: string) {
  const groups: DirectoryGroup[] = (groupId === ALL ? input.groups : input.groups.filter((g) => g.id === groupId)).map((g) => {
    const pms = pmsOf(input, g.id);
    const t = totalsFor(input, clientsOfPms(input, pms));
    return {
      id: g.id,
      name: g.name,
      pmCount: pms.length,
      clientCount: t.clientCount,
      contract: t.contract,
      pms: pms.map((p) => {
        const ids = uniq(input.clientsByPm[p.id] ?? []).filter((id) => input.clients[id]);
        const pt = totalsFor(input, ids);
        return {
          id: p.id,
          name: p.name,
          clientCount: pt.clientCount,
          contract: pt.contract,
          clients: ids
            .map((id) => ({ id, name: input.clients[id].name, contract: withVatSplit(input.clients[id].contractTaxable, input.clients[id].contractExempt, input.includeVat) }))
            .sort((a, b) => a.name.localeCompare(b.name, "ko")),
        };
      }),
    };
  });
  const shown = groups.flatMap((g) => g.pms.map((p) => p.id));
  const total = totalsFor(input, clientsOfPms(input, input.pms.filter((p) => shown.includes(p.id))));
  return { groups, total: { pmCount: shown.length, clientCount: total.clientCount, contract: total.contract } };
}
