// 주간 공유 히스토리의 순수 로직: 조회 기간 → 주 목록, 행 구성·정렬·검색, 복사용 텍스트.
// DB를 읽는 일은 data/weekly-share.ts(loadWeeklyHistory)가, 화면은 이 결과를 그대로 그린다.
import type { OtherWorkView, WeeklyShareView } from "@/lib/data/weekly-share";
import type { Ym } from "@/lib/month-range";
import { describeShareStamp } from "@/lib/weekly-share-view";
import { addWeeks, weekLabel, weekMonth, weekStartOf, weeksOverlappingMonth, type WeekKey } from "@/lib/week";

export type HistoryMode = "month" | "all" | "range";

export type HistoryShare = WeeklyShareView & { clientId: string; weekStart: string };
export type HistoryOther = OtherWorkView & { authorId: string | null; weekStart: string };

export type HistoryRow =
  | {
      kind: "client";
      key: string;
      weekStart: string;
      pmId: string | null; // 고객사 하나만 볼 때는 PM 구분이 없다(null)
      pmName: string | null;
      partName: string | null;
      clientId: string;
      clientName: string;
      share: WeeklyShareView | null; // null = 그 주 미작성
    }
  | {
      kind: "other";
      key: string;
      weekStart: string;
      pmId: string;
      pmName: string;
      partName: string | null;
      other: OtherWorkView;
    };

// ---- 조회 기간 → 주 목록 --------------------------------------------------------------------

/** 조회 기간에 해당하는 주(오래된 순). 이번 주 이후는 포함하지 않는다. */
export function historyWeeks(o: {
  mode: HistoryMode;
  ym?: Ym;
  earliestWeek?: WeekKey | null;
  from?: string;
  to?: string;
  curWeek: WeekKey;
}): WeekKey[] {
  const { curWeek } = o;
  if (o.mode === "month") {
    if (!o.ym) return [];
    return weeksOverlappingMonth(o.ym.year, o.ym.month).filter((w) => w <= curWeek);
  }
  let start: WeekKey;
  let end: WeekKey;
  if (o.mode === "all") {
    start = o.earliestWeek ?? curWeek;
    end = curWeek;
  } else {
    if (o.from && o.to && o.from > o.to) return [];
    // 시작일이 터무니없이 옛날이어도 주 수가 폭주하지 않게, 가장 이른 기록 주(없으면 2000년)보다 앞으로는 가지 않는다.
    const floor = o.earliestWeek ?? WEEK_FLOOR;
    // (0100-01-01 같은 값은 weekStartOf가 자릿수가 다른 문자열을 만들어 비교가 틀어지므로 원래 날짜 문자열로 먼저 거른다)
    const fromWeek = o.from ? (o.from < WEEK_FLOOR ? floor : weekStartOf(o.from)) : null;
    start = fromWeek ? (fromWeek < floor ? floor : fromWeek) : o.earliestWeek ?? curWeek;
    const toWeek = o.to ? weekStartOf(o.to) : curWeek;
    end = toWeek < curWeek ? toWeek : curWeek;
  }
  const out: WeekKey[] = [];
  for (let w = start; w <= end; w = addWeeks(w, 1)) out.push(w);
  return out;
}

// ---- 행 구성 ----------------------------------------------------------------------------------

type PmInfo = { id: string; name: string; partName: string | null };
type ClientInfo = { id: string; name: string };

// 주 목록의 하한(2000-01-02는 일요일). month-range의 YEAR_MIN(2000)과 같은 해.
const WEEK_FLOOR: WeekKey = "2000-01-02";

const lc = (s: string) => s.toLowerCase();

function matchesShare(q: string, clientName: string, v: WeeklyShareView): boolean {
  return lc([v.thisWeek, v.nextWeek, v.note, clientName].join("\n")).includes(q);
}
function matchesOther(q: string, o: OtherWorkView): boolean {
  return lc([o.thisWeek, o.nextWeek, o.note, o.tags.join(" "), "기타 업무"].join("\n")).includes(q);
}

/**
 * 히스토리 표의 행. 순서: PM(파트 순서대로 미리 정렬된 pms 순) → 고객사 이름순 → 주차 최신순, PM마다 기타 업무가 뒤에 붙는다.
 * 공동 담당 고객사는 담당 PM 각자 아래에 모두 나온다. 검색어가 있으면 맞는 기록만 남기고 미작성 행은 숨긴다.
 * 고객사 하나를 고르면 PM 구분 없이 그 고객사의 주차만(미작성 주차 포함) 최신순으로 보여 준다.
 */
export function buildHistoryRows(o: {
  pms: PmInfo[];
  clientsByPm: Record<string, ClientInfo[]>;
  shares: HistoryShare[];
  others: HistoryOther[];
  weeks: WeekKey[];
  clientFilter: string; // "" = 전체, "other" = 기타 업무만, 그 외 = 고객사 id
  showMissing: boolean;
  query: string;
}): HistoryRow[] {
  const q = lc(o.query.trim());
  const weeksDesc = [...o.weeks].sort().reverse();
  const shareMap = new Map(o.shares.map((s) => [`${s.clientId}|${s.weekStart}`, s]));
  const otherMap = new Map(o.others.map((x) => [`${x.authorId}|${x.weekStart}`, x]));
  const rows: HistoryRow[] = [];

  // 고객사 하나만 보기
  if (o.clientFilter && o.clientFilter !== "other") {
    const client = Object.values(o.clientsByPm).flat().find((c) => c.id === o.clientFilter);
    if (!client) return [];
    for (const w of weeksDesc) {
      const share = shareMap.get(`${client.id}|${w}`) ?? null;
      if (share ? q && !matchesShare(q, client.name, share) : !!q) continue;
      rows.push({
        kind: "client", key: `-|client|${client.id}|${w}`, weekStart: w, pmId: null, pmName: null, partName: null,
        clientId: client.id, clientName: client.name, share: share ? stripKeys(share) : null,
      });
    }
    return rows;
  }

  for (const pm of o.pms) {
    if (o.clientFilter !== "other") {
      const clients = [...(o.clientsByPm[pm.id] ?? [])].sort((a, b) => a.name.localeCompare(b.name, "ko"));
      for (const c of clients) {
        for (const w of weeksDesc) {
          const share = shareMap.get(`${c.id}|${w}`);
          if (share) {
            if (q && !matchesShare(q, c.name, share)) continue;
          } else if (!o.showMissing || q) {
            continue;
          }
          rows.push({
            kind: "client", key: `${pm.id}|client|${c.id}|${w}`, weekStart: w, pmId: pm.id, pmName: pm.name, partName: pm.partName,
            clientId: c.id, clientName: c.name, share: share ? stripKeys(share) : null,
          });
        }
      }
    }
    for (const w of weeksDesc) {
      const other = otherMap.get(`${pm.id}|${w}`);
      if (!other || (q && !matchesOther(q, other))) continue;
      rows.push({
        kind: "other", key: `${pm.id}|other|${w}`, weekStart: w, pmId: pm.id, pmName: pm.name, partName: pm.partName,
        other: stripOtherKeys(other),
      });
    }
  }
  return rows;
}

function stripKeys({ clientId: _c, weekStart: _w, ...view }: HistoryShare): WeeklyShareView {
  void _c; void _w;
  return view;
}
function stripOtherKeys({ authorId: _a, weekStart: _w, ...view }: HistoryOther): OtherWorkView {
  void _a; void _w;
  return view;
}

// ---- 복사용 텍스트 ----------------------------------------------------------------------------

const oneLine = (s: string) => (s ? s.split("\n").join(" / ") : "-");
const monthIndex = (weekStart: string) => {
  const m = weekMonth(weekStart);
  return m.year * 12 + m.month;
};

/**
 * 지금 조회한 조건 그대로의 텍스트(메일·메신저 붙여넣기용). 미작성 행은 뺀다.
 * section을 주면 모든 행을 그 제목(예: "2026년 11월") 한 구역으로, 없으면 주의 소속 월별로 나눈다.
 * grouped: 파트·PM 줄을 넣는다(관리자 보기). single: 고객사 줄을 생략한다(고객사 하나만 볼 때).
 */
export function historyText(
  rows: HistoryRow[],
  opt: { scope: string; rangeLabel: string; grouped: boolean; single?: boolean; section?: string },
): string {
  const items = rows.filter((r) => r.kind === "other" || r.share);
  const ordered = opt.section ? items : [...items].sort((a, b) => monthIndex(b.weekStart) - monthIndex(a.weekStart));
  let t = `[주간공유] ${opt.scope} · ${opt.rangeLabel}\n`;
  let lastMonth = opt.section ? opt.section : "";
  let lastPart: string | null = null;
  let lastPm: string | null = null;
  let lastGroup = "";
  if (opt.section) t += `\n■ ${opt.section}\n`;

  for (const r of ordered) {
    if (!opt.section) {
      const m = weekMonth(r.weekStart);
      const title = `${m.year}년 ${m.month}월`;
      if (title !== lastMonth) {
        lastMonth = title;
        lastPart = lastPm = null;
        lastGroup = "";
        t += `\n■ ${title}\n`;
      }
    }
    if (opt.grouped && r.pmId) {
      const part = r.partName ?? "파트 미지정";
      if (part !== lastPart) {
        lastPart = part;
        lastPm = null;
        lastGroup = "";
        t += `\n[${part}]\n`;
      }
      if (r.pmId !== lastPm) {
        lastPm = r.pmId;
        lastGroup = "";
        t += `● ${r.pmName}\n`;
      }
    }
    let ind = "";
    if (!opt.single) {
      const group = `${r.pmId ?? "-"}/${r.kind === "client" ? r.clientId : "other"}`;
      if (group !== lastGroup) {
        lastGroup = group;
        t += `  ▸ ${r.kind === "client" ? r.clientName : "기타 업무"}\n`;
      }
      ind = "    ";
    }
    const label = weekLabel(r.weekStart);
    if (r.kind === "client") {
      const s = r.share!;
      const stamp = describeShareStamp(s);
      if (s.noSpecial) {
        t += `${ind}- ${label}: 특이사항 없음\n${ind}  작성: ${stamp}\n`;
      } else {
        t += `${ind}- ${label}\n${ind}  이번주: ${oneLine(s.thisWeek)}\n${ind}  다음주: ${oneLine(s.nextWeek)}\n`;
        if (s.note) t += `${ind}  비고: ${oneLine(s.note)}\n`;
        t += `${ind}  작성: ${stamp}\n`;
      }
    } else {
      const o = r.other;
      const tags = o.tags.length ? ` [${o.tags.join(", ")}]` : "";
      const stamp = describeShareStamp({ createdByName: r.pmName, updatedByName: r.pmName, createdAt: o.createdAt, editedAt: o.editedAt });
      t += `${ind}- ${label}${tags}\n${ind}  이번주: ${oneLine(o.thisWeek)}\n${ind}  다음주: ${oneLine(o.nextWeek)}\n`;
      if (o.note) t += `${ind}  비고: ${oneLine(o.note)}\n`;
      t += `${ind}  작성: ${stamp}\n`;
    }
  }
  return t;
}
