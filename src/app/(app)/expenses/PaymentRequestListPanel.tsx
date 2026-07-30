// src/app/(app)/expenses/PaymentRequestListPanel.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { PAYMENT_REQUEST_PAGE_SIZE, type PaymentRequestRow } from "@/lib/data/payment-requests";
import type { PayeeOption } from "@/lib/data/payees";
import type { AppRole } from "@/lib/auth/rbac";
import { ClientCombobox } from "@/components/ClientCombobox";
import { PaymentRequestPager } from "./PaymentRequestPager";
import { PaymentRequestNoticeBanner } from "./PaymentRequestNoticeBanner";
import { PaymentRequestDetailModal } from "./PaymentRequestDetailModal";
import { formatWon } from "@/lib/format";
import {
  PAYMENT_REQUEST_ENTITY_LABELS, PAYMENT_REQUEST_ENTITY_BY_LABEL, paymentRequestEntityLabel,
  PAYMENT_REQUEST_STATUS_LABELS, paymentRequestStatusLabel,
} from "@/lib/labels";

type FilterValues = {
  payDateFrom: string; payDateTo: string; clientId: string; entity: string; status: string; bizName: string;
};

const NOT_IMPLEMENTED = "추후 구현 예정입니다.";

function dateStr(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "-";
}

export function PaymentRequestListPanel({
  rows,
  page,
  totalPages,
  clients,
  payees,
  filterValues,
  role,
  currentUserId,
}: {
  rows: PaymentRequestRow[];
  page: number;
  totalPages: number;
  clients: { id: string; name: string; businessType: string | null }[];
  payees: PayeeOption[];
  filterValues: FilterValues;
  role: AppRole;
  currentUserId: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailTarget, setDetailTarget] = useState<PaymentRequestRow | null>(null);
  const canExport = role === "ADMIN" || role === "SETTLEMENT";
  const allSelected = rows.length > 0 && selected.size === rows.length;

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }

  const filterParams: Record<string, string> = {
    payDateFrom: filterValues.payDateFrom,
    payDateTo: filterValues.payDateTo,
    clientId: filterValues.clientId,
    entity: filterValues.entity,
    status: filterValues.status,
    bizName: filterValues.bizName,
  };

  return (
    <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <PaymentRequestNoticeBanner />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-hover)] p-4">
        <input type="hidden" name="tab" value="payment-request" />
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          지급일
          <span className="mt-1 flex items-center gap-1">
            <input type="date" name="payDateFrom" defaultValue={filterValues.payDateFrom} className="w-40 rounded border border-[var(--color-border)] px-2 py-2 text-sm" />
            ~
            <input type="date" name="payDateTo" defaultValue={filterValues.payDateTo} className="w-40 rounded border border-[var(--color-border)] px-2 py-2 text-sm" />
          </span>
        </label>
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          고객사
          <ClientCombobox clients={clients} defaultClientId={filterValues.clientId || undefined} className="mt-1 w-48" />
        </label>
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          지급명의
          <select name="entity" defaultValue={filterValues.entity} className="mt-1 w-32 rounded border border-[var(--color-border)] px-2 py-2 text-sm">
            <option value="">전체</option>
            {PAYMENT_REQUEST_ENTITY_LABELS.map((label) => (
              <option key={label} value={PAYMENT_REQUEST_ENTITY_BY_LABEL[label]}>{label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          지급여부
          <select name="status" defaultValue={filterValues.status} className="mt-1 w-32 rounded border border-[var(--color-border)] px-2 py-2 text-sm">
            <option value="">전체</option>
            <option value="PREPARING">{PAYMENT_REQUEST_STATUS_LABELS[0]}</option>
            <option value="COMPLETED">{PAYMENT_REQUEST_STATUS_LABELS[1]}</option>
          </select>
        </label>
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          사업자명(이름)
          <input type="text" name="bizName" defaultValue={filterValues.bizName} placeholder="검색어 입력" className="mt-1 w-40 rounded border border-[var(--color-border)] px-2 py-2 text-sm" />
        </label>
        <button type="submit" className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white">🔍 조회</button>
      </form>

      <div className="mb-4 flex justify-end gap-2">
        {canExport && (
          <button type="button" onClick={() => alert(NOT_IMPLEMENTED)} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">
            📗 엑셀 다운로드
          </button>
        )}
        <button
          type="button"
          onClick={() => alert(NOT_IMPLEMENTED)}
          disabled={selected.size === 0}
          className="rounded border border-[var(--color-border)] px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          🗓️ 일괄수정{selected.size > 0 ? ` (${selected.size}건 선택)` : ""}
        </button>
        <button
          type="button"
          onClick={() => alert(NOT_IMPLEMENTED)}
          disabled={selected.size === 0}
          className="rounded bg-[var(--color-danger)] px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          🗑️ 삭제{selected.size > 0 ? ` (${selected.size}건 선택)` : ""}
        </button>
        {role === "PM" ? (
          <Link href="/expenses/payment-request/new" className="rounded bg-[var(--color-success)] px-4 py-2 text-sm text-white">
            + 등록
          </Link>
        ) : (
          <button type="button" onClick={() => alert(NOT_IMPLEMENTED)} className="rounded bg-[var(--color-success)] px-4 py-2 text-sm text-white">
            + 등록
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-center text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[var(--color-muted)]">
              <th className="w-10 whitespace-nowrap px-3 py-2 align-middle">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} aria-label="전체선택" />
              </th>
              <th className="whitespace-nowrap px-3 py-2">No</th>
              <th className="whitespace-nowrap px-3 py-2">신청일</th>
              <th className="whitespace-nowrap px-3 py-2">신청인</th>
              <th className="whitespace-nowrap px-3 py-2">지급명의</th>
              <th className="whitespace-nowrap px-3 py-2">고객사</th>
              <th className="whitespace-nowrap px-3 py-2">사업자명(이름)</th>
              <th className="whitespace-nowrap px-3 py-2">지급액</th>
              <th className="whitespace-nowrap px-3 py-2">지급일</th>
              <th className="whitespace-nowrap px-3 py-2">지급여부</th>
              <th className="whitespace-nowrap px-3 py-2">관리</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className={`border-b border-[var(--color-border)] ${selected.has(r.id) ? "bg-[var(--color-hover)]" : ""}`}>
                <td className="whitespace-nowrap px-3 py-2 align-middle">
                  <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} aria-label={`${r.bizName} 선택`} />
                </td>
                <td className="whitespace-nowrap px-3 py-2">{(page - 1) * PAYMENT_REQUEST_PAGE_SIZE + i + 1}</td>
                <td className="whitespace-nowrap px-3 py-2">{dateStr(r.requestedAt)}</td>
                <td className="whitespace-nowrap px-3 py-2">{r.requesterName}</td>
                <td className="whitespace-nowrap px-3 py-2">{paymentRequestEntityLabel(r.entity)}</td>
                <td className="whitespace-nowrap px-3 py-2">{r.clientName}</td>
                <td className="whitespace-nowrap px-3 py-2">{r.bizName}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatWon(r.amount)}</td>
                <td className="whitespace-nowrap px-3 py-2">{dateStr(r.payDate)}</td>
                <td className="whitespace-nowrap px-3 py-2">{paymentRequestStatusLabel(r.status)}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <div className="flex justify-center gap-2">
                    <button type="button" onClick={() => setDetailTarget(r)} className="text-[var(--color-muted)] hover:text-[var(--color-primary)]" aria-label="상세">🔍</button>
                    <button type="button" onClick={() => alert(NOT_IMPLEMENTED)} className="text-[var(--color-muted)] hover:text-[var(--color-danger)]" aria-label="삭제">🗑️</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <PaymentRequestPager page={page} totalPages={totalPages} filterParams={filterParams} />

      {rows.length === 0 && (
        <p className="mt-4 text-center text-sm text-[var(--color-muted)]">
          {Object.values(filterValues).some((v) => v) ? "검색 결과가 없습니다." : "등록된 지급요청이 없습니다."}
        </p>
      )}

      {detailTarget && (
        <PaymentRequestDetailModal
          row={detailTarget}
          role={role}
          currentUserId={currentUserId}
          onClose={() => setDetailTarget(null)}
        />
      )}
    </div>
  );
}
