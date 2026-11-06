import type { SessionUser } from "@/lib/auth/session";
import type { RlsContext } from "@/lib/rls";
import { kstToday } from "@/lib/week";
import { loadWeeklyHistory, type WeeklyHistoryData } from "@/lib/data/weekly-share";
import { buildHistoryRows, historyWeeks, type HistoryMode } from "@/lib/weekly-history";
import { HistoryFilter } from "./HistoryFilter";
import { HistoryTable } from "./HistoryTable";
import type { AdminLists, WeeklyRange } from "./range";

// 히스토리 탭의 조회 조건(모두 URL 쿼리). 이 값이 곧 "복사할 텍스트"의 조건이 된다.
export type HistoryParams = {
  ym?: string; // 월별 조회의 달 "YYYY-MM"
  mode?: string; // month | all | range
  from?: string; // 기간 설정 시작일
  to?: string; // 기간 설정 종료일
  part?: string; // (관리자) 파트
  pm?: string; // (관리자) PM, 비우면 전체
  client?: string; // 고객사 id | "other"(기타 업무) | 비우면 전체
  q?: string; // 검색어
  miss?: string; // "1"이면 미작성 주차도 보기
};

const dateOnly = (s?: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s ?? "") ? (s as string) : "");

export async function HistoryView({
  ctx, user, writer, range, sp, adminLists,
}: {
  ctx: RlsContext;
  user: SessionUser;
  writer: boolean;
  range: WeeklyRange;
  sp: HistoryParams;
  adminLists: AdminLists | null;
}) {
  const mode: HistoryMode = sp.mode === "all" || sp.mode === "range" ? sp.mode : "month";
  const { ym, minYm, maxYm, curWeek, earliestWeek } = range;
  const today = kstToday();
  const from = dateOnly(sp.from);
  const to = dateOnly(sp.to);
  const weeks = historyWeeks({ mode, ym, earliestWeek, from, to, curWeek });

  // ---- 누구의 기록을 보는가: 작성 역할은 본인(담당 고객사), 관리자는 파트·PM을 골라 본다 ----
  let pmIds: string[] = [user.id];
  let admin: { parts: AdminLists["parts"]; pms: AdminLists["pms"]; partId: string; pmId: string } | null = null;
  if (!writer && adminLists) {
    const partId = adminLists.parts.some((p) => p.id === sp.part) ? (sp.part as string) : "";
    const inPart = adminLists.pms.filter((p) => !partId || p.partId === partId);
    const pmId = inPart.some((p) => p.id === sp.pm) ? (sp.pm as string) : "";
    pmIds = pmId ? [pmId] : inPart.map((p) => p.id);
    admin = { parts: adminLists.parts, pms: adminLists.pms, partId, pmId };
  }

  const empty: WeeklyHistoryData = { pms: [], clientsByPm: {}, shares: [], others: [] };
  const data = pmIds.length && weeks.length ? await loadWeeklyHistory(ctx, { pmIds, weeks }) : empty;

  // 고객사 선택 목록: 조회 대상 PM들의 담당 고객사(관리자에게는 담당 PM 이름을 붙인다)
  const pmName = new Map(data.pms.map((p) => [p.id, p.name]));
  const byClient = new Map<string, { name: string; pms: string[] }>();
  for (const [pmId, cs] of Object.entries(data.clientsByPm)) {
    for (const c of cs) {
      const e = byClient.get(c.id) ?? { name: c.name, pms: [] };
      e.pms.push(pmName.get(pmId) ?? "");
      byClient.set(c.id, e);
    }
  }
  const clientOptions = [...byClient.entries()]
    .map(([id, v]) => ({ id, label: writer ? v.name : `${v.name} · ${v.pms.sort().join(", ")}` }))
    .sort((a, b) => a.label.localeCompare(b.label, "ko"));
  const clientFilter = sp.client === "other" ? "other" : byClient.has(sp.client ?? "") ? (sp.client as string) : "";
  const single = !!clientFilter && clientFilter !== "other";

  const rows = buildHistoryRows({
    pms: data.pms,
    clientsByPm: data.clientsByPm,
    shares: data.shares,
    others: data.others,
    weeks,
    clientFilter,
    showMissing: sp.miss === "1" && clientFilter === "",
    query: sp.q ?? "",
  });

  // 수정은 그 고객사의 담당 PM 본인만(관리자는 보기만). 기타 업무는 작성자 본인만.
  const mine = new Set((data.clientsByPm[user.id] ?? []).map((c) => c.id));
  const editableKeys = !writer
    ? []
    : rows.filter((r) => (r.kind === "client" ? !!r.share && mine.has(r.clientId) : r.pmId === user.id)).map((r) => r.key);

  const dedupe = new Set(rows.filter((r) => r.kind === "client" && r.share).map((r) => (r.kind === "client" ? `${r.clientId}|${r.weekStart}` : "")));
  const counts = {
    shares: dedupe.size, // 공동 담당 고객사는 한 번만 센다
    others: rows.filter((r) => r.kind === "other").length,
    missing: rows.filter((r) => r.kind === "client" && !r.share).length,
  };

  const fmt = (s: string) => (s ? s.replace(/-/g, ".") : "…");
  const rangeLabel = mode === "month" ? `${ym.year}년 ${ym.month}월` : mode === "all" ? "전체 기간" : `${fmt(from)} – ${fmt(to)}`;
  const scope = single
    ? clientOptions.find((c) => c.id === clientFilter)?.label.split(" · ")[0] ?? ""
    : clientFilter === "other"
      ? `기타 업무 · PM ${data.pms.length}명`
      : writer
        ? `내 고객사 ${byClient.size}곳`
        : `PM ${data.pms.length}명 · 고객사 ${byClient.size}곳`;

  return (
    <div className="flex flex-col gap-4">
      <HistoryFilter
        mode={mode}
        ym={ym}
        minYm={minYm}
        maxYm={maxYm}
        from={from}
        to={to}
        today={today}
        q={sp.q ?? ""}
        miss={sp.miss === "1"}
        clientFilter={clientFilter}
        clientOptions={clientOptions}
        admin={admin}
      />
      {pmIds.length === 0 ? (
        <p className="rounded-[14px] border border-dashed border-[var(--color-border)] p-8 text-center text-[var(--color-muted)]">
          조회할 수 있는 PM이 없습니다.
        </p>
      ) : mode === "range" && from && to && from > to ? (
        <p className="rounded-[14px] border border-dashed border-[var(--color-border)] p-8 text-center text-[var(--color-muted)]">
          시작일이 종료일보다 늦어요. 날짜를 다시 골라 주세요.
        </p>
      ) : (
        <HistoryTable
          key={`${mode}|${ym.year}-${ym.month}|${from}|${to}|${clientFilter}|${sp.q ?? ""}|${sp.miss ?? ""}|${admin?.partId ?? ""}|${admin?.pmId ?? ""}`}
          rows={rows}
          editableKeys={editableKeys}
          writer={writer}
          grouped={!writer && !single}
          single={single}
          section={mode === "month" ? rangeLabel : null}
          scope={scope}
          rangeLabel={rangeLabel}
          counts={counts}
        />
      )}
    </div>
  );
}
