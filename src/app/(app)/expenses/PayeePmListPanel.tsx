"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PayeePmRow as PayeePmRowData, PayeePmSearchField } from "@/lib/data/payees";
import { deletePayeesAction } from "./payees/actions";
import { PayeeUploadModal } from "./PayeeUploadModal";
import { PayeeAttachmentModal } from "./PayeeAttachmentModal";
import { PayeeDeleteConfirmModal } from "./PayeeDeleteConfirmModal";
import { PayeePmRow } from "./PayeePmRow";

const SEARCH_FIELD_OPTIONS: { value: PayeePmSearchField; label: string }[] = [
  { value: "bizName", label: "사업자명(이름)" },
  { value: "keyId", label: "고유번호" },
  { value: "phone", label: "연락처" },
];

export function PayeePmListPanel({
  rows,
  field,
  q,
}: {
  rows: PayeePmRowData[];
  field: PayeePmSearchField;
  q: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const [uploadOpen, setUploadOpen] = useState(false);
  const [attachmentTarget, setAttachmentTarget] = useState<{ id: string; keyId: string; bizName: string } | null>(null);
  const [searchField, setSearchField] = useState<PayeePmSearchField>(field);
  const [deleteTarget, setDeleteTarget] = useState<string[] | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const allSelected = rows.length > 0 && selected.size === rows.length;

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleteError(null);
    setDeletePending(true);
    const result = await deletePayeesAction(deleteTarget);
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

  return (
    <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <form method="get" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="tab" value="payment-list" />
          <span className="text-sm text-[var(--color-muted)]">검색:</span>
          <select
            name="field"
            value={searchField}
            onChange={(e) => setSearchField(e.target.value as PayeePmSearchField)}
            className="rounded border border-[var(--color-border)] px-3 py-2 text-sm"
          >
            {SEARCH_FIELD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="검색어 입력"
            className="w-64 rounded border border-[var(--color-border)] px-3 py-2 text-sm"
          />
          <button type="submit" className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white">
            🔍 조회
          </button>
        </form>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDeleteTarget(Array.from(selected))}
            disabled={selected.size === 0}
            className="rounded bg-[var(--color-danger)] px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            🗑️ 삭제{selected.size > 0 ? ` (${selected.size}건 선택)` : ""}
          </button>
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            className="rounded bg-[var(--color-success)] px-4 py-2 text-sm text-white"
          >
            + 등록
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-center text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[var(--color-muted)]">
              <th className="w-10 whitespace-nowrap px-3 py-2 align-middle">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} aria-label="전체선택" />
              </th>
              <th className="whitespace-nowrap px-3 py-2">고유번호</th>
              <th className="whitespace-nowrap px-3 py-2">사업자명(이름)</th>
              <th className="whitespace-nowrap px-3 py-2">연락처</th>
              <th className="whitespace-nowrap px-3 py-2">은행명</th>
              <th className="whitespace-nowrap px-3 py-2">계좌번호</th>
              <th className="whitespace-nowrap px-3 py-2">예금주</th>
              <th className="whitespace-nowrap px-3 py-2">청구방식</th>
              <th className="whitespace-nowrap px-3 py-2">첨부파일</th>
              <th className="whitespace-nowrap px-3 py-2">관리</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <PayeePmRow
                key={r.id}
                row={r}
                isEditing={editing.has(r.id)}
                isSelected={selected.has(r.id)}
                onToggleSelect={() => toggleSelect(r.id)}
                onStartEdit={() => startEditing(r.id)}
                onStopEdit={() => stopEditing(r.id)}
                onOpenAttachment={() => setAttachmentTarget({ id: r.id, keyId: r.keyId, bizName: r.bizName })}
                onRequestDelete={() => setDeleteTarget([r.id])}
              />
            ))}
          </tbody>
        </table>
      </div>

      {rows.length === 0 && (
        <p className="mt-4 text-center text-sm text-[var(--color-muted)]">
          {q.trim() ? "검색 결과가 없습니다." : "등록된 지급 대상이 없습니다."}
        </p>
      )}

      {uploadOpen && <PayeeUploadModal open onClose={() => setUploadOpen(false)} />}
      {attachmentTarget && (
        <PayeeAttachmentModal
          open
          payeeId={attachmentTarget.id}
          keyId={attachmentTarget.keyId}
          bizName={attachmentTarget.bizName}
          canDownload={false}
          canDelete={false}
          onClose={() => setAttachmentTarget(null)}
        />
      )}
      <PayeeDeleteConfirmModal
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
