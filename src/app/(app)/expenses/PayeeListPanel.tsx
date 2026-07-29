"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PayeeRow as PayeeRowData, PayeeSearchField } from "@/lib/data/payees";
import { deletePayeesAction } from "./payees/actions";
import { PayeeUploadModal } from "./PayeeUploadModal";
import { PayeeAttachmentModal } from "./PayeeAttachmentModal";
import { PayeeDeleteConfirmModal } from "./PayeeDeleteConfirmModal";
import { PayeeRow } from "./PayeeRow";

const SEARCH_FIELD_OPTIONS: { value: PayeeSearchField; label: string }[] = [
  { value: "bizName", label: "사업자명(이름)" },
  { value: "bizNumber", label: "사업자번호" },
  { value: "keyId", label: "고유번호" },
];

export function PayeeListPanel({
  rows,
  field,
  q,
}: {
  rows: PayeeRowData[];
  field: PayeeSearchField;
  q: string;
}) {
  const router = useRouter();
  // 체크박스 선택 행(선택만 — 편집과 무관). 다음 단계에서 일괄 작업 연결.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 편집 모드 행(관리 연필 아이콘으로 진입).
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const [uploadOpen, setUploadOpen] = useState(false);
  const [attachmentTarget, setAttachmentTarget] = useState<{ id: string; keyId: string; bizName: string } | null>(null);
  const [searchField, setSearchField] = useState<PayeeSearchField>(field);
  // 삭제 확인 대상 id 목록. null=모달 닫힘. 개별 삭제는 [id] 하나, 일괄 삭제는 selected 전체.
  const [deleteTarget, setDeleteTarget] = useState<string[] | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const allSelected = rows.length > 0 && selected.size === rows.length;
  // 체크된 행이 있으면 그 항목만, 없으면 현재 검색/필터 결과 전체를 다운로드 대상으로 삼는다.
  const selectedKeyIds = rows.filter((r) => selected.has(r.id)).map((r) => r.keyId);
  const exportHref = selectedKeyIds.length > 0
    ? `/expenses/payees/export?keyIds=${encodeURIComponent(selectedKeyIds.join(","))}`
    : `/expenses/payees/export?field=${field}&q=${encodeURIComponent(q)}`;

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
      {/* 상단 바: 좌측 검색 / 우측 액션. 우측 액션 로직은 다음 단계. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <form method="get" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="tab" value="payment-list" />
          <span className="text-sm text-[var(--color-muted)]">검색:</span>
          <select
            name="field"
            value={searchField}
            onChange={(e) => setSearchField(e.target.value as PayeeSearchField)}
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
            maxLength={searchField === "bizNumber" ? 8 : undefined}
            placeholder="검색어 입력 (하이픈 제외 가능)"
            className="w-64 rounded border border-[var(--color-border)] px-3 py-2 text-sm"
          />
          <button type="submit" className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white">
            🔍 조회
          </button>
        </form>
        <div className="flex items-center gap-2">
          {rows.length > 0 ? (
            <a
              href={exportHref}
              className="rounded border border-[var(--color-border)] px-4 py-2 text-sm"
            >
              📗 엑셀 다운로드{selectedKeyIds.length > 0 ? ` (${selectedKeyIds.length}건 선택)` : ""}
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
          )}
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

      {/* 목록 테이블 — 헤더/내용 모두 가운데 정렬 */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-center text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[var(--color-muted)]">
              <th className="w-10 whitespace-nowrap px-3 py-2 align-middle">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} aria-label="전체선택" />
              </th>
              <th className="whitespace-nowrap px-3 py-2">고유번호</th>
              <th className="whitespace-nowrap px-3 py-2">사업자명(이름)</th>
              <th className="whitespace-nowrap px-3 py-2">사업자번호(주민등록번호)</th>
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
              <PayeeRow
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
