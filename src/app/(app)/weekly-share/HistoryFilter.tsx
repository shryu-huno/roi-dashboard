"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ymValue, type Ym } from "@/lib/month-range";
import type { HistoryMode } from "@/lib/weekly-history";
import { YearMonthControls } from "./YearMonthControls";
import { FIELD } from "./filter-style";

type Admin = {
  parts: { id: string; name: string }[];
  pms: { id: string; name: string; partId: string | null }[];
  partId: string;
  pmId: string;
};

const selectCls =
  "h-[38px] rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-primary)]";
const MODES: { value: HistoryMode; label: string }[] = [
  { value: "month", label: "월별" },
  { value: "all", label: "전체" },
  { value: "range", label: "기간 설정" },
];

// 히스토리 필터: [파트][PM](관리자) · [고객사] · [기간: 월별/전체/기간 설정] · [검색] · 미작성 주차 보기.
// 바꾸면 [조회] 없이 바로 이동하고, 모든 조건은 URL에 담긴다.
export function HistoryFilter({
  mode, ym, minYm, maxYm, from, to, today, q, miss, clientFilter, clientOptions, admin,
}: {
  mode: HistoryMode;
  ym: Ym;
  minYm: Ym;
  maxYm: Ym;
  from: string;
  to: string;
  today: string;
  q: string;
  miss: boolean;
  clientFilter: string;
  clientOptions: { id: string; label: string }[];
  admin: Admin | null;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  type Patch = Partial<{ mode: HistoryMode; ym: Ym; from: string; to: string; part: string; pm: string; client: string; q: string; miss: boolean }>;
  function go(patch: Patch) {
    const next = {
      mode, ym, from, to, q, miss,
      part: admin?.partId ?? "", pm: admin?.pmId ?? "", client: clientFilter,
      ...patch,
    };
    const params = new URLSearchParams({ tab: "history", mode: next.mode, ym: ymValue(next.ym) });
    if (next.mode === "range") {
      if (next.from) params.set("from", next.from);
      if (next.to) params.set("to", next.to);
    }
    if (next.part) params.set("part", next.part);
    if (next.pm) params.set("pm", next.pm);
    if (next.client) params.set("client", next.client);
    if (next.q) params.set("q", next.q);
    if (next.miss && !next.client) params.set("miss", "1");
    router.push(`/weekly-share?${params.toString()}`);
  }

  const visiblePms = admin ? admin.pms.filter((p) => !admin.partId || p.partId === admin.partId) : [];
  const firstOfMonth = `${ym.year}-${String(ym.month).padStart(2, "0")}-01`;

  return (
    <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex flex-wrap items-end gap-4">
        {admin && (
          <>
            <label className={FIELD}>
              파트
              <select className={`mt-1.5 w-32 ${selectCls}`} value={admin.partId} onChange={(e) => go({ part: e.target.value, pm: "", client: "" })}>
                <option value="">전체</option>
                {admin.parts.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            <label className={FIELD}>
              PM
              <select className={`mt-1.5 w-36 ${selectCls}`} value={admin.pmId} onChange={(e) => go({ pm: e.target.value, client: "" })}>
                <option value="">전체</option>
                {visiblePms.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
          </>
        )}

        <label className={FIELD}>
          고객사
          <select className={`mt-1.5 w-56 ${selectCls}`} value={clientFilter} onChange={(e) => go({ client: e.target.value })}>
            <option value="">전체</option>
            <option value="other">기타 업무</option>
            {clientOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </label>

        <div className={FIELD}>
          기간
          <div className="mt-1.5 inline-flex h-[38px] items-center gap-0.5 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-bg)] p-0.5" role="group" aria-label="기간">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                aria-pressed={mode === m.value}
                onClick={() => go({ mode: m.value, ...(m.value === "range" && !from && !to ? { from: firstOfMonth, to: today } : {}) })}
                className={`h-8 rounded-[8px] px-3 text-sm font-medium ${
                  mode === m.value ? "bg-[var(--color-surface)] text-[var(--color-primary)] shadow-sm" : "text-[var(--color-muted)]"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {mode === "month" && <YearMonthControls ym={ym} minYm={minYm} maxYm={maxYm} onChange={(target) => go({ ym: target })} />}
        {mode === "range" && (
          <div className={FIELD}>
            날짜
            <div className="mt-1.5 flex items-center gap-1.5">
              <input type="date" aria-label="시작일" max={today} value={from} onChange={(e) => go({ from: e.target.value })} className={`w-40 ${selectCls}`} />
              <span>~</span>
              <input type="date" aria-label="종료일" max={today} value={to} onChange={(e) => go({ to: e.target.value })} className={`w-40 ${selectCls}`} />
            </div>
          </div>
        )}

        <label className={`${FIELD} min-w-[10rem] flex-1`}>
          검색
          <input
            type="search"
            value={query}
            placeholder="내용·고객사 검색"
            onChange={(e) => {
              const v = e.target.value;
              setQuery(v);
              clearTimeout(timer.current);
              timer.current = setTimeout(() => go({ q: v }), 350);
            }}
            className={`mt-1.5 w-full ${selectCls}`}
          />
        </label>

        {!clientFilter && (
          <label className="flex h-[38px] select-none items-center gap-2 text-sm text-[var(--color-muted)]">
            <input type="checkbox" checked={miss} onChange={(e) => go({ miss: e.target.checked })} />
            미작성 주차도 보기
          </label>
        )}
      </div>
    </div>
  );
}
