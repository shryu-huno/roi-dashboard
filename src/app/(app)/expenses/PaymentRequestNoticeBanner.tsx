// src/app/(app)/expenses/PaymentRequestNoticeBanner.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updatePaymentRequestNoticeAction } from "./payment-request/actions";

export function PaymentRequestNoticeBanner({
  content,
  canEdit,
}: {
  content: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleStartEdit() {
    setDraft(content);
    setError(null);
    setEditing(true);
  }

  function handleCancel() {
    setDraft(content);
    setError(null);
    setEditing(false);
  }

  function handleSave() {
    const formData = new FormData();
    formData.set("content", draft);

    setError(null);
    startTransition(async () => {
      const result = await updatePaymentRequestNoticeAction(formData);
      if (result.ok) {
        router.refresh();
        setEditing(false);
      } else {
        setError(result.error ?? "저장 중 오류가 발생했습니다.");
      }
    });
  }

  if (editing) {
    return (
      <div className="mb-4 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-hover)] px-4 py-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm focus:border-[var(--color-primary)] focus:outline-none"
          placeholder="공지 내용을 입력하세요."
        />
        <div className="mt-2 flex items-center justify-end gap-2">
          {error && <p className="mr-auto text-xs text-[var(--color-danger)]">{error}</p>}
          <button
            type="button"
            onClick={handleSave}
            disabled={pending}
            className="rounded bg-[var(--color-success)] px-3 py-1.5 text-xs text-white disabled:opacity-60"
          >
            {pending ? "저장 중..." : "저장"}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={pending}
            className="rounded border border-[var(--color-border)] px-3 py-1.5 text-xs"
          >
            취소
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4 flex items-start justify-between gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-hover)] px-4 py-3 text-sm text-[var(--color-muted)]">
      <p className="whitespace-pre-wrap">{content || "📢 등록된 공지가 없습니다."}</p>
      {canEdit && (
        <button
          type="button"
          onClick={handleStartEdit}
          className="shrink-0 whitespace-nowrap text-[var(--color-muted)] hover:text-[var(--color-primary)]"
          aria-label="공지 수정"
        >
          ✏️ 수정
        </button>
      )}
    </div>
  );
}
