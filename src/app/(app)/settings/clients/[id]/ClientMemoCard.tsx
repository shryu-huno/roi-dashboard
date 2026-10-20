"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateClientMemoAction, deleteClientMemoAction } from "../actions";
import type { MemoItem } from "./ClientMemoSection";

// 메모 한 건. 작성자·작성일시와 함께 보이고, 담당 PM 전원·관리자가 수정/삭제할 수 있다(RLS로 범위 제한).
export function ClientMemoCard({ clientId, memo }: { clientId: string; memo: MemoItem }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(memo.content);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleCancel() {
    setDraft(memo.content);
    setError(null);
    setEditing(false);
  }

  function handleSave() {
    const formData = new FormData();
    formData.set("id", memo.id);
    formData.set("clientId", clientId);
    formData.set("content", draft);
    setError(null);
    startTransition(async () => {
      const result = await updateClientMemoAction({ ok: true }, formData);
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
      <li className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm focus:border-[var(--color-primary)] focus:outline-none"
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
      </li>
    );
  }

  return (
    <li className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <p className="whitespace-pre-wrap text-sm text-[var(--color-fg)]">{memo.content}</p>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-[var(--color-muted)]">
        <span>
          {memo.authorName} · {memo.createdAt}
        </span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => { setDraft(memo.content); setError(null); setEditing(true); }}
            className="hover:text-[var(--color-primary)]"
          >
            ✏️ 수정
          </button>
          <form
            action={deleteClientMemoAction}
            onSubmit={(e) => {
              if (!confirm("이 메모를 삭제하시겠습니까?")) e.preventDefault();
            }}
          >
            <input type="hidden" name="id" value={memo.id} />
            <input type="hidden" name="clientId" value={clientId} />
            <button type="submit" className="hover:text-[var(--color-danger)]">🗑️ 삭제</button>
          </form>
        </div>
      </div>
    </li>
  );
}
