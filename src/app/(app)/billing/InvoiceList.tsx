"use client";

import { useState } from "react";
import type { InvoiceRow as InvoiceRowData } from "@/lib/data/invoices";
import { InvoiceRow } from "./InvoiceRow";

type SortKey = "clientName" | "businessType" | "pmLabel" | "amount" | "issueDate" | "paidDate";
type Sort = { key: SortKey; dir: "asc" | "desc" };

function sortRows(rows: InvoiceRowData[], sort: Sort | null): InvoiceRowData[] {
  if (!sort) return rows;
  const { key, dir } = sort;
  const mul = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    // 값이 없는(null/빈) 사업자구분·입금일자는 방향과 무관하게 항상 맨 아래.
    if (key === "businessType" || key === "paidDate") {
      const av = key === "businessType" ? a.businessType : a.paidDate ? new Date(a.paidDate).getTime() : null;
      const bv = key === "businessType" ? b.businessType : b.paidDate ? new Date(b.paidDate).getTime() : null;
      const aNull = av === null || av === undefined || av === "";
      const bNull = bv === null || bv === undefined || bv === "";
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      return key === "businessType"
        ? mul * String(av).localeCompare(String(bv), "ko")
        : mul * ((av as number) - (bv as number));
    }
    if (key === "clientName") return mul * a.clientName.localeCompare(b.clientName, "ko");
    if (key === "pmLabel") return mul * a.pmLabel.localeCompare(b.pmLabel, "ko");
    if (key === "amount") return mul * (a.amount - b.amount);
    return mul * (new Date(a.issueDate).getTime() - new Date(b.issueDate).getTime()); // issueDate
  });
}

// 청구 리스트. 접근 가능한 전체 청구를 표시(범위 제한은 RLS가 처리).
// 고객사~입금일자 모든 열을 오름/내림차순 정렬할 수 있다.
export function InvoiceList({
  rows,
  clients,
}: {
  rows: InvoiceRowData[];
  clients: { id: string; name: string }[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort | null>(null);

  if (rows.length === 0) {
    return <p className="text-[var(--color-muted)]">등록된 청구가 없습니다.</p>;
  }

  const sorted = sortRows(rows, sort);

  function toggle(key: SortKey) {
    setSort((s) => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }
  const arrow = (key: SortKey) => (sort?.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "");

  const thCls = "px-3 py-4 text-left text-sm font-bold text-[var(--color-muted)] whitespace-nowrap";
  const sortBtn = "inline-flex items-center gap-0.5 hover:text-[var(--color-fg)]";
  const sortTh = (k: SortKey, label: string, right?: boolean) => (
    <th className={`${thCls}${right ? " text-right" : ""}`}>
      <button type="button" onClick={() => toggle(k)} className={sortBtn}>{label}{arrow(k)}</button>
    </th>
  );

  return (
    <div className="overflow-x-auto rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)]">
            {sortTh("clientName", "고객사")}
            {sortTh("businessType", "사업자 구분")}
            {sortTh("pmLabel", "담당 PM")}
            {sortTh("amount", "청구금액(VAT 포함)", true)}
            {sortTh("issueDate", "계산서 발행일자")}
            {sortTh("paidDate", "입금일자")}
            <th className={thCls}>비고</th>
            <th className={thCls}>관리</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <InvoiceRow
              key={r.id}
              row={r}
              clients={clients}
              isEditing={editingId === r.id}
              onStartEdit={() => setEditingId(r.id)}
              onStopEdit={() => setEditingId(null)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
