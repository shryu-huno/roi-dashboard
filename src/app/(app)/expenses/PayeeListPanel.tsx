"use client";

import { useState } from "react";
import { taxTypeLabel } from "@/lib/labels";
import type { TaxType } from "@prisma/client";
import type { PayeeRow, PayeeSearchField } from "@/lib/data/payees";
import { PayeeUploadModal } from "./PayeeUploadModal";
import { PayeeAttachmentModal } from "./PayeeAttachmentModal";

const SEARCH_FIELD_OPTIONS: { value: PayeeSearchField; label: string }[] = [
  { value: "bizName", label: "사업자명(이름)" },
  { value: "bizNumber", label: "사업자번호" },
  { value: "keyId", label: "고유번호" },
];

// 은행명 편집용 드롭다운 옵션.
const BANKS = ["국민은행", "신한은행", "하나은행", "우리은행", "농협은행", "기업은행", "카카오뱅크", "토스뱅크"] as const;

// 청구방식별 뱃지 색 — 스키마 TaxType 6종 전체. 시안 미포함(현금영수증/수기계산서)도 정의.
const TAX_BADGE_CLASS: Record<TaxType, string> = {
  TAX_INVOICE: "bg-blue-100 text-blue-700",
  TAX_FREE_INVOICE: "bg-green-100 text-green-700",
  BUSINESS_INCOME: "bg-amber-100 text-amber-700",
  OTHER_INCOME: "bg-gray-100 text-gray-600",
  CASH_RECEIPT: "bg-teal-100 text-teal-700",
  HANDWRITTEN_INVOICE: "bg-purple-100 text-purple-700",
};

function TaxBadge({ taxType }: { taxType: TaxType }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${TAX_BADGE_CLASS[taxType]}`}>
      {taxTypeLabel(taxType)}
    </span>
  );
}

function AttachmentCell({ hasAttachment, onClick }: { hasAttachment: boolean; onClick: () => void }) {
  if (hasAttachment) {
    return (
      <button type="button" onClick={onClick} className="whitespace-nowrap text-sm text-[var(--color-primary)] hover:underline">
        📎 첨부파일
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-block whitespace-nowrap rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-[var(--color-danger)] hover:underline"
    >
      ⚠ 미첨부
    </button>
  );
}

const inputCls =
  "w-full rounded border border-[var(--color-border)] px-2 py-1.5 text-center text-sm focus:border-[var(--color-primary)] focus:outline-none";
// 모든 셀 공통: 가운데 정렬 + 세로 가운데 + 줄바꿈 방지(편집 시 글자가 아래로 내려가지 않게).
const cellCls = "whitespace-nowrap px-3 py-2 text-center align-middle";

export function PayeeListPanel({
  rows,
  field,
  q,
}: {
  rows: PayeeRow[];
  field: PayeeSearchField;
  q: string;
}) {
  // 체크박스 선택 행(선택만 — 편집과 무관). 다음 단계에서 일괄 작업 연결.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 편집 모드 행(관리 연필 아이콘으로 진입).
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const [uploadOpen, setUploadOpen] = useState(false);
  const [attachmentTarget, setAttachmentTarget] = useState<{ id: string; keyId: string; bizName: string } | null>(null);
  const [searchField, setSearchField] = useState<PayeeSearchField>(field);

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
          <button type="button" className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">
            📗 엑셀 다운로드
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
            {rows.map((r) => {
              const isEditing = editing.has(r.id);
              const isSelected = selected.has(r.id);
              return (
                <tr
                  key={r.id}
                  className={`border-b border-[var(--color-border)] ${isEditing || isSelected ? "bg-[var(--color-hover)]" : ""}`}
                >
                  <td className={cellCls}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(r.id)}
                      aria-label={`${r.bizName} 선택`}
                    />
                  </td>
                  <td className={`${cellCls} font-medium text-[var(--color-primary)]`}>{r.keyId}</td>

                  {/* 사업자명 */}
                  <td className={cellCls}>
                    {isEditing ? <input className={inputCls} defaultValue={r.bizName} /> : r.bizName}
                  </td>

                  {/* 사업자번호(마스킹) — 민감정보, 편집 모드에서도 읽기 전용 */}
                  <td className={`${cellCls} text-[var(--color-muted)]`}>{r.bizNumberMasked}</td>

                  {/* 은행명(드롭다운) */}
                  <td className={cellCls}>
                    {isEditing ? (
                      <select className={inputCls} defaultValue={r.bankName}>
                        {BANKS.map((b) => (
                          <option key={b} value={b}>{b}</option>
                        ))}
                      </select>
                    ) : (
                      r.bankName
                    )}
                  </td>

                  {/* 계좌번호 */}
                  <td className={cellCls}>
                    {isEditing ? <input className={inputCls} defaultValue={r.accountNumber} /> : r.accountNumber}
                  </td>

                  {/* 예금주 */}
                  <td className={cellCls}>
                    {isEditing ? <input className={inputCls} defaultValue={r.accountHolder} /> : r.accountHolder}
                  </td>

                  {/* 청구방식 뱃지 */}
                  <td className={cellCls}><TaxBadge taxType={r.taxType} /></td>

                  {/* 첨부파일 */}
                  <td className={cellCls}>
                    <AttachmentCell
                      hasAttachment={r.hasBizCert || r.hasBankbook}
                      onClick={() => setAttachmentTarget({ id: r.id, keyId: r.keyId, bizName: r.bizName })}
                    />
                  </td>

                  {/* 관리: 연필 아이콘으로 편집 진입, 편집 중엔 저장/취소 */}
                  <td className={cellCls}>
                    {isEditing ? (
                      <div className="flex justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => stopEditing(r.id)}
                          className="whitespace-nowrap rounded bg-[var(--color-success)] px-3 py-1.5 text-xs text-white"
                        >
                          저장
                        </button>
                        <button
                          type="button"
                          onClick={() => stopEditing(r.id)}
                          className="whitespace-nowrap rounded border border-[var(--color-border)] px-3 py-1.5 text-xs"
                        >
                          취소
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEditing(r.id)}
                        className="text-[var(--color-muted)] hover:text-[var(--color-primary)]"
                        aria-label="편집"
                      >
                        ✏️
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
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
    </div>
  );
}
