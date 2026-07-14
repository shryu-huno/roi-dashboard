"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { filterClients, sortClients, formatCycle, type SortMode } from "@/lib/clients/summary-view";
import { formatPercent } from "@/lib/format";

type ClientItem = {
  id: string;
  name: string;
  status: string;
  industry: string | null;
  pmLabel: string;
  progress: number | null; // 올해 실적/계약. 계약 없음이면 null.
  billingCycle: string[];
  reportCycle: string[];
};

const SORTS: { value: SortMode; label: string }[] = [
  { value: "name", label: "가나다순" },
  { value: "pm", label: "PM별" },
  { value: "industry", label: "업종별" },
];

export function ClientsList({ clients, showPm }: { clients: ClientItem[]; showPm: boolean }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("name");

  // PM 접속 시엔 담당 고객사만 보이므로 PM별 정렬은 의미가 없어 숨긴다.
  const sortOptions = showPm ? SORTS : SORTS.filter((s) => s.value !== "pm");

  const filtered = useMemo(() => sortClients(filterClients(clients, query, sort), sort), [clients, query, sort]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">고객사 목록</h1>
        <div className="flex items-center gap-2">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortMode)}
            className="rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-primary)]"
          >
            {sortOptions.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={sort === "pm" ? "PM 검색" : sort === "industry" ? "업종 검색" : "고객사 검색"}
            className="w-56 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-primary)]"
          />
        </div>
      </div>
      {clients.length === 0 ? (
        <p className="text-[var(--color-muted)]">담당 고객사가 없습니다.</p>
      ) : filtered.length === 0 ? (
        <p className="text-[var(--color-muted)]">검색 결과가 없습니다.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <Link
              key={c.id}
              href={`/clients/${c.id}`}
              className="block rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm hover:border-[var(--color-primary)]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="text-base font-medium text-[var(--color-fg)]">{c.name}</div>
                <div className="shrink-0 text-sm font-semibold text-[var(--color-primary)]">
                  {c.progress === null ? "실적 계약" : formatPercent(c.progress)}
                </div>
              </div>
              <div className="mt-1 flex items-end justify-between gap-2">
                <div className="text-xs text-[var(--color-muted)]">
                  {c.status} · {c.industry ?? "미분류"}
                  {showPm && ` · ${c.pmLabel}`}
                </div>
                <div className="shrink-0 text-right text-xs text-[var(--color-fg)]">
                  청구:{formatCycle(c.billingCycle)} | 보고:{formatCycle(c.reportCycle)}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
