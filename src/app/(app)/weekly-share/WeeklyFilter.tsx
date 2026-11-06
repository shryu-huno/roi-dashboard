"use client";

import { useRouter } from "next/navigation";
import { ymValue, type Ym } from "@/lib/month-range";
import { YearMonthControls } from "./YearMonthControls";
import { FIELD } from "./filter-style";

export type WeekChip = {
  key: string; // 그 주 일요일
  label: string; // "11월 1주차"
  range: string; // "11/1–11/7"
  status: "done" | "part" | "none"; // 담당 고객사 전부 / 일부 / 아직 없음
  future: boolean; // 아직 오지 않은 주(선택 불가)
};

export type AdminPick = {
  parts: { id: string; name: string }[];
  pms: { id: string; name: string; partId: string | null }[];
  partId: string; // "" = 전체
  pmId: string;
};

const selectCls =
  "h-[38px] rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-primary)]";
const statusMark: Record<WeekChip["status"], string> = {
  done: "●", // 담당 고객사 전부 제출
  part: "◐", // 일부 제출
  none: "○", // 아직 없음
};

// 선택한 달 소속 주는 "1주차"로, 다음 달 소속(걸친 주)은 "12월 1주차"처럼 달을 붙여 헷갈리지 않게 한다.
function chipLabel(label: string, month: number): string {
  const m = /^(\d+)월 /.exec(label);
  return m && Number(m[1]) === month ? label.replace(/^\d+월 /, "") : label;
}

// 주간 공유 필터: [연도 ‹ ›] [월 ‹ ›] [주차 드롭다운] (+ 관리자는 [파트][PM]). 바꾸면 바로 이동한다.
// 연도·월 모두 ‹ ›와 직접 입력이 가능하고, 이동 범위는 [minYm, maxYm](데이터가 있는 달 ~ 이번 달,
// 첫 사용 시에도 최근 3개월은 이동 가능)이며 범위를 넘는 값은 범위 안으로 맞춘다.
export function WeeklyFilter({
  ym, minYm, maxYm, weeks, selectedWeek, admin,
}: {
  ym: Ym;
  minYm: Ym;
  maxYm: Ym;
  weeks: WeekChip[];
  selectedWeek: string;
  admin: AdminPick | null;
}) {
  const router = useRouter();

  function go(next: { ym?: Ym; week?: string; partId?: string; pmId?: string }) {
    const params = new URLSearchParams({ tab: "batch" });
    params.set("ym", ymValue(next.ym ?? ym));
    if (next.week) params.set("week", next.week);
    if (admin) {
      const part = next.partId ?? admin.partId;
      const pm = next.pmId ?? admin.pmId;
      if (part) params.set("part", part);
      if (pm) params.set("pm", pm);
    }
    router.push(`/weekly-share?${params.toString()}`);
  }

  const visiblePms = admin ? admin.pms.filter((p) => !admin.partId || p.partId === admin.partId) : [];

  return (
    <div className="mb-4 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex flex-wrap items-end gap-4">
        {admin && (
          <>
            <label className={FIELD}>
              파트
              <select
                className={`mt-1.5 w-32 ${selectCls}`}
                value={admin.partId}
                onChange={(e) => {
                  const partId = e.target.value;
                  // 파트를 바꾸면 그 파트의 첫 PM으로 이동(전체면 PM 선택 유지)
                  const first = admin.pms.find((p) => !partId || p.partId === partId);
                  go({ partId, pmId: first?.id ?? "" });
                }}
              >
                <option value="">전체</option>
                {admin.parts.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            <label className={FIELD}>
              PM
              <select className={`mt-1.5 w-36 ${selectCls}`} value={admin.pmId} onChange={(e) => go({ pmId: e.target.value })}>
                {visiblePms.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
          </>
        )}

        <YearMonthControls ym={ym} minYm={minYm} maxYm={maxYm} onChange={(target) => go({ ym: target, week: "" })} />

        <label className={FIELD}>
          주차
          <select
            className={`mt-1.5 w-60 ${selectCls}`}
            value={selectedWeek}
            onChange={(e) => go({ week: e.target.value })}
          >
            {weeks.map((w) => (
              <option key={w.key} value={w.key} disabled={w.future}>
                {`${statusMark[w.future ? "none" : w.status]} ${chipLabel(w.label, ym.month)}  ${w.range}`}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
