"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { BidStatusFilter } from "@/lib/bids";
import type { Ym } from "@/lib/month-range";
import { YearMonthControls } from "./YearMonthControls";
import { FIELD } from "./filter-style";

const selectCls =
  "h-[38px] rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-primary)]";
const STATUS: { value: BidStatusFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "live", label: "진행 중" },
  { value: "won", label: "수주" },
  { value: "closed", label: "실주·유찰" },
];
const DUE: { value: "all" | "month"; label: string }[] = [
  { value: "month", label: "월별" },
  { value: "all", label: "전체" },
];

// 입찰·수주 필터: [상태] [제출 마감: 전체/월별 + 연도·월] [검색]. 바꾸면 바로 이동하고 조건은 URL에 담긴다.
export function BidFilter({
  status, due, ym, minYm, maxYm, q,
}: {
  status: BidStatusFilter;
  due: "all" | "month";
  ym: Ym;
  minYm: Ym;
  maxYm: Ym;
  q: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  type Patch = Partial<{ status: BidStatusFilter; due: "all" | "month"; ym: Ym; q: string }>;
  function go(patch: Patch) {
    const next = { status, due, ym, q, ...patch };
    const params = new URLSearchParams({ tab: "bids", status: next.status, due: next.due });
    if (next.due === "month") {
      params.set("year", String(next.ym.year));
      params.set("month", String(next.ym.month));
    }
    if (next.q) params.set("q", next.q);
    router.push(`/weekly-share?${params.toString()}`);
  }

  const segCls = (active: boolean) =>
    `h-8 rounded-[8px] px-3 text-sm font-medium ${active ? "bg-[var(--color-surface)] text-[var(--color-primary)] shadow-sm" : "text-[var(--color-muted)]"}`;
  const segWrap = "mt-1.5 inline-flex h-[38px] items-center gap-0.5 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-bg)] p-0.5";

  return (
    <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className={FIELD}>
          상태
          <div className={segWrap} role="group" aria-label="상태">
            {STATUS.map((s) => (
              <button key={s.value} type="button" aria-pressed={status === s.value} onClick={() => go({ status: s.value })} className={segCls(status === s.value)}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className={FIELD}>
          제출 마감
          <div className={segWrap} role="group" aria-label="제출 마감 기간">
            {DUE.map((d) => (
              <button key={d.value} type="button" aria-pressed={due === d.value} onClick={() => go({ due: d.value })} className={segCls(due === d.value)}>
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {due === "month" && <YearMonthControls ym={ym} minYm={minYm} maxYm={maxYm} onChange={(target) => go({ ym: target })} />}

        <label className={`${FIELD} min-w-[10rem] flex-1`}>
          검색
          <input
            type="search"
            value={query}
            placeholder="발주처·사업명·비고 검색"
            onChange={(e) => {
              const v = e.target.value;
              setQuery(v);
              clearTimeout(timer.current);
              timer.current = setTimeout(() => go({ q: v }), 350);
            }}
            className={`mt-1.5 w-full ${selectCls}`}
          />
        </label>
      </div>
    </div>
  );
}
