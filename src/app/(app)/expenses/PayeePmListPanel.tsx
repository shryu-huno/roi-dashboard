"use client";

import { useState } from "react";
import type { PayeePmRow as PayeePmRowData, PayeePmSearchField } from "@/lib/data/payees";
import { PayeeUploadModal } from "./PayeeUploadModal";
import { PayeeAttachmentModal } from "./PayeeAttachmentModal";
import { PayeePmRow } from "./PayeePmRow";
import { PayeePager } from "./PayeePager";

const SEARCH_FIELD_OPTIONS: { value: PayeePmSearchField; label: string }[] = [
  { value: "bizName", label: "사업자명(이름)" },
  { value: "keyId", label: "고유번호" },
  { value: "phone", label: "연락처" },
];

export function PayeePmListPanel({
  rows,
  field,
  q,
  page,
  totalPages,
}: {
  rows: PayeePmRowData[];
  field: PayeePmSearchField;
  q: string;
  page: number;
  totalPages: number;
}) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [attachmentTarget, setAttachmentTarget] = useState<{ id: string; keyId: string; bizName: string } | null>(null);
  const [searchField, setSearchField] = useState<PayeePmSearchField>(field);

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
              <th className="whitespace-nowrap px-3 py-2">고유번호</th>
              <th className="whitespace-nowrap px-3 py-2">사업자명(이름)</th>
              <th className="whitespace-nowrap px-3 py-2">연락처</th>
              <th className="whitespace-nowrap px-3 py-2">은행명</th>
              <th className="whitespace-nowrap px-3 py-2">계좌번호</th>
              <th className="whitespace-nowrap px-3 py-2">예금주</th>
              <th className="whitespace-nowrap px-3 py-2">청구방식</th>
              <th className="whitespace-nowrap px-3 py-2">첨부파일</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <PayeePmRow
                key={r.id}
                row={r}
                onOpenAttachment={() => setAttachmentTarget({ id: r.id, keyId: r.keyId, bizName: r.bizName })}
              />
            ))}
          </tbody>
        </table>
      </div>

      <PayeePager page={page} totalPages={totalPages} field={field} q={q} />

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
    </div>
  );
}
