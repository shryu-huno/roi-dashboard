// src/app/(app)/expenses/PaymentRequestListPanel.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { PaymentRequestRow as PaymentRequestRowData } from "@/lib/data/payment-requests";
import type { PayeeOption } from "@/lib/data/payees";
import type { AppRole } from "@/lib/auth/rbac";
import { ClientCombobox } from "@/components/ClientCombobox";
import { SelectDropdown } from "@/components/SelectDropdown";
import { SuggestInput } from "@/components/SuggestInput";
import { PaymentRequestPager } from "./PaymentRequestPager";
import { PaymentRequestNoticeBanner } from "./PaymentRequestNoticeBanner";
import { PaymentRequestDetailModal } from "./PaymentRequestDetailModal";
import { PaymentRequestBulkUpdateModal } from "./PaymentRequestBulkUpdateModal";
import { PaymentRequestExcelUploadModal } from "./PaymentRequestExcelUploadModal";
import { PaymentRequestDeleteConfirmModal } from "./PaymentRequestDeleteConfirmModal";
import { PaymentRequestRow } from "./PaymentRequestRow";
import { deletePaymentRequestsAction } from "./payment-request/actions";
import { formatWon } from "@/lib/format";
import {
  PAYMENT_REQUEST_ENTITY_LABELS, PAYMENT_REQUEST_ENTITY_BY_LABEL, paymentRequestEntityLabel,
  PAYMENT_REQUEST_STATUS_LABELS, paymentRequestStatusLabel,
} from "@/lib/labels";

type FilterValues = {
  payDateFrom: string; payDateTo: string; clientId: string; entity: string; status: string; bizName: string;
};

function dateStr(d: Date | null): string {
  return d ? d.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }) : "-";
}

// PM은 지급준비 상태 + 본인 신청 건만 체크박스 선택/삭제 대상이 될 수 있다.
function pmCanAct(row: PaymentRequestRowData, currentUserId: string): boolean {
  return row.status === "PREPARING" && row.requesterId === currentUserId;
}

export function PaymentRequestListPanel({
  rows,
  page,
  totalPages,
  clients,
  payees,
  bizNames,
  filterValues,
  role,
  currentUserId,
}: {
  rows: PaymentRequestRowData[];
  page: number;
  totalPages: number;
  clients: { id: string; name: string; businessType: string | null }[];
  payees: PayeeOption[];
  bizNames: string[];
  filterValues: FilterValues;
  role: AppRole;
  currentUserId: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const [detailTarget, setDetailTarget] = useState<PaymentRequestRowData | null>(null);
  const [bulkUpdateOpen, setBulkUpdateOpen] = useState(false);
  const [excelUploadOpen, setExcelUploadOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string[] | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const canExport = role === "ADMIN" || role === "SETTLEMENT";

  // PM은 지급준비+본인 신청 건만 선택 가능 — "전체선택"도 그 범위로 제한한다.
  const selectableRows = role === "PM" ? rows.filter((r) => pmCanAct(r, currentUserId)) : rows;
  const allSelected = selectableRows.length > 0 && selectableRows.every((r) => selected.has(r.id));

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(selectableRows.map((r) => r.id)));
  }

  function startEditing(id: string) {
    setEditing((prev) => new Set(prev).add(id));
  }

  function stopEditing(id: string) {
    setEditing((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleteError(null);
    setDeletePending(true);
    const result = await deletePaymentRequestsAction(deleteTarget);
    setDeletePending(false);
    if (result.ok) {
      setSelected(new Set());
      setDeleteTarget(null);
      router.refresh();
    } else {
      setDeleteError(result.error ?? "삭제 중 오류가 발생했습니다.");
    }
  }

  function handleCancelDelete() {
    setDeleteTarget(null);
    setDeleteError(null);
  }

  function handleBulkUpdateSuccess() {
    setSelected(new Set());
    setBulkUpdateOpen(false);
    router.refresh();
  }

  const filterParams: Record<string, string> = {
    payDateFrom: filterValues.payDateFrom,
    payDateTo: filterValues.payDateTo,
    clientId: filterValues.clientId,
    entity: filterValues.entity,
    status: filterValues.status,
    bizName: filterValues.bizName,
  };

  // 체크된 행이 있으면 그 항목만, 없으면 현재 검색/필터 결과 전체를 다운로드 대상으로 삼는다.
  const selectedIds = rows.filter((r) => selected.has(r.id)).map((r) => r.id);
  const exportHref = selectedIds.length > 0
    ? `/expenses/payment-request/export?ids=${encodeURIComponent(selectedIds.join(","))}`
    : `/expenses/payment-request/export?${new URLSearchParams(filterParams).toString()}`;

  return (
    <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <PaymentRequestNoticeBanner />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-hover)] p-4">
        <input type="hidden" name="tab" value="payment-request" />
        <div className="flex flex-1 flex-wrap items-end justify-center gap-3">
          <label className="flex flex-col items-center text-sm text-[var(--color-fg)]">
            지급명의
            <SelectDropdown
              name="entity"
              defaultValue={filterValues.entity}
              options={[
                { value: "", label: "전체" },
                ...PAYMENT_REQUEST_ENTITY_LABELS.map((label) => ({ value: PAYMENT_REQUEST_ENTITY_BY_LABEL[label], label })),
              ]}
              className="mt-1 w-24"
            />
          </label>
          <label className="flex flex-col items-center text-sm text-[var(--color-fg)]">
            고객사
            <ClientCombobox clients={clients} defaultClientId={filterValues.clientId || undefined} className="mt-1 w-64" />
          </label>
          <label className="flex flex-col items-center text-sm text-[var(--color-fg)]">
            사업자명(이름)
            <SuggestInput
              name="bizName"
              defaultValue={filterValues.bizName}
              suggestions={bizNames}
              placeholder="사업자명(이름) 검색"
              className="mt-1 w-56"
            />
          </label>
          <label className="flex flex-col items-center text-sm text-[var(--color-fg)]">
            지급일
            <span className="mt-1 flex items-center gap-1">
              <input type="date" name="payDateFrom" defaultValue={filterValues.payDateFrom} className="w-40 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2 text-center text-sm" />
              ~
              <input type="date" name="payDateTo" defaultValue={filterValues.payDateTo} className="w-40 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2 text-center text-sm" />
            </span>
          </label>
          <label className="flex flex-col items-center text-sm text-[var(--color-fg)]">
            지급여부
            <SelectDropdown
              name="status"
              defaultValue={filterValues.status}
              options={[
                { value: "", label: "전체" },
                { value: "PREPARING", label: PAYMENT_REQUEST_STATUS_LABELS[0] },
                { value: "COMPLETED", label: PAYMENT_REQUEST_STATUS_LABELS[1] },
              ]}
              className="mt-1 w-24"
            />
          </label>
        </div>
        <button type="submit" className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white">🔍 조회</button>
      </form>

      <div className="mb-4 flex justify-end gap-2">
        {canExport && (
          rows.length > 0 ? (
            <a href={exportHref} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">
              📗 엑셀 다운로드{selectedIds.length > 0 ? ` (${selectedIds.length}건 선택)` : ""}
            </a>
          ) : (
            <button
              type="button"
              disabled
              title="다운로드할 데이터가 없습니다"
              className="cursor-not-allowed rounded border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-muted)] opacity-50"
            >
              📗 엑셀 다운로드
            </button>
          )
        )}
        {canExport && (
          <button type="button" onClick={() => setExcelUploadOpen(true)} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">
            ⬆ 엑셀 업로드
          </button>
        )}
        {canExport && (
          <button
            type="button"
            onClick={() => setBulkUpdateOpen(true)}
            disabled={selected.size === 0}
            className="rounded border border-[var(--color-border)] px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            🗓️ 수정{selected.size > 0 ? ` (${selected.size}건 선택)` : ""}
          </button>
        )}
        <button
          type="button"
          onClick={() => setDeleteTarget(Array.from(selected))}
          disabled={selected.size === 0}
          className="rounded bg-[var(--color-danger)] px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          🗑️ 삭제{selected.size > 0 ? ` (${selected.size}건 선택)` : ""}
        </button>
        {role === "PM" && (
          <Link href="/expenses/payment-request/new" className="rounded bg-[var(--color-success)] px-4 py-2 text-sm text-white">
            + 등록
          </Link>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-center text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[var(--color-muted)]">
              <th className="w-10 whitespace-nowrap px-3 py-2 align-middle">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} disabled={selectableRows.length === 0} aria-label="전체선택" />
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
            {role === "PM" ? rows.map((r) => (
              <tr key={r.id} className={`border-b border-[var(--color-border)] ${selected.has(r.id) ? "bg-[var(--color-hover)]" : ""}`}>
                <td className="whitespace-nowrap px-3 py-2 align-middle">
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggleSelect(r.id)}
                    disabled={!pmCanAct(r, currentUserId)}
                    aria-label={`${r.bizName} 선택`}
                  />
                </td>
                <td className="whitespace-nowrap px-3 py-2">{r.seqNo}</td>
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
                    <button type="button" onClick={() => setDetailTarget(r)} className="text-[var(--color-muted)] hover:text-[var(--color-primary)]" aria-label="편집">✏️</button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget([r.id])}
                      disabled={!pmCanAct(r, currentUserId)}
                      className="text-[var(--color-muted)] hover:text-[var(--color-danger)] disabled:cursor-not-allowed disabled:opacity-30"
                      aria-label="삭제"
                    >
                      🗑️
                    </button>
                  </div>
                </td>
              </tr>
            )) : rows.map((r) => (
              <PaymentRequestRow
                key={r.id}
                row={r}
                isEditing={editing.has(r.id)}
                isSelected={selected.has(r.id)}
                clients={clients}
                payees={payees}
                onToggleSelect={() => toggleSelect(r.id)}
                onStartEdit={() => startEditing(r.id)}
                onStopEdit={() => stopEditing(r.id)}
                onRequestDelete={() => setDeleteTarget([r.id])}
              />
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
          clients={clients}
          payees={payees}
          onClose={() => setDetailTarget(null)}
        />
      )}

      {bulkUpdateOpen && (
        <PaymentRequestBulkUpdateModal
          ids={Array.from(selected)}
          onClose={() => setBulkUpdateOpen(false)}
          onSuccess={handleBulkUpdateSuccess}
        />
      )}

      {excelUploadOpen && (
        <PaymentRequestExcelUploadModal onClose={() => setExcelUploadOpen(false)} />
      )}

      <PaymentRequestDeleteConfirmModal
        open={deleteTarget !== null}
        count={deleteTarget?.length ?? 0}
        pending={deletePending}
        error={deleteError}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />
    </div>
  );
}
