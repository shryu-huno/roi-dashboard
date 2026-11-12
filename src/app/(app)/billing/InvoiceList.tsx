"use client";

import { useMemo, useState } from "react";
import type { InvoiceRow as InvoiceRowData } from "@/lib/data/invoices";
import { PaymentRequestClientCombobox } from "@/components/PaymentRequestClientCombobox";
import { InvoiceRow } from "./InvoiceRow";

type SortKey = "clientName" | "businessType" | "pmLabel" | "amount" | "issueDate" | "paidDate";
type Sort = { key: SortKey; dir: "asc" | "desc" };
type StatusFilter = "all" | "unpaid" | "paid";
type Filters = { clientId: string; from: string; to: string; status: StatusFilter };

// 발행일자를 YYYY-MM 문자열로. type="month" 입력값과 직접 비교하기 위함.
function ym(date: Date | string): string {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// 정렬 전에 적용하는 조회 필터. 고객사·발행일자 기간·입금상태.
function filterRows(rows: InvoiceRowData[], f: Filters): InvoiceRowData[] {
  return rows.filter((r) => {
    if (f.clientId && r.clientId !== f.clientId) return false;
    if (f.from || f.to) {
      const m = ym(r.issueDate);
      if (f.from && m < f.from) return false;
      if (f.to && m > f.to) return false;
    }
    if (f.status === "unpaid" && r.paidDate !== null) return false;
    if (f.status === "paid" && r.paidDate === null) return false;
    return true;
  });
}

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

// 청구 리스트. 접근 가능한 청구를 표시(범위 제한은 RLS가 처리).
// 상단 필터 바(고객사·발행일자 기간·입금상태)로 조회 범위를 좁힐 수 있고,
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
  const [filters, setFilters] = useState<Filters>({ clientId: "", from: "", to: "", status: "all" });

  const visible = useMemo(() => sortRows(filterRows(rows, filters), sort), [rows, filters, sort]);

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

  const selectCls =
    "mt-1 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-primary)]";
  const labelCls = "flex flex-col text-xs text-[var(--color-muted)]";

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <label className={labelCls}>
          고객사
          <div className="mt-1 w-52">
            <PaymentRequestClientCombobox
              clients={clients}
              selectedId={filters.clientId || null}
              onSelect={(c) => setFilters((f) => ({ ...f, clientId: c?.id ?? "" }))}
            />
          </div>
        </label>
        <label className={labelCls}>
          발행일자(시작)
          <input
            type="month"
            value={filters.from}
            onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
            className={selectCls}
          />
        </label>
        <label className={labelCls}>
          발행일자(종료)
          <input
            type="month"
            value={filters.to}
            onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
            className={selectCls}
          />
        </label>
        <label className={labelCls}>
          입금상태
          <select
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as StatusFilter }))}
            className={selectCls}
          >
            <option value="all">전체</option>
            <option value="unpaid">미입금</option>
            <option value="paid">입금완료</option>
          </select>
        </label>
      </div>

      {rows.length === 0 ? (
        <p className="text-[var(--color-muted)]">등록된 청구가 없습니다.</p>
      ) : visible.length === 0 ? (
        <p className="text-[var(--color-muted)]">조건에 맞는 청구가 없습니다.</p>
      ) : (
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
              {visible.map((r) => (
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
      )}
    </div>
  );
}
