"use client";

import { useActionState, useEffect, useRef } from "react";
import { createClientMemoAction } from "../actions";
import { OK } from "@/lib/action-state";
import { ClientMemoCard } from "./ClientMemoCard";

export type MemoItem = { id: string; content: string; authorName: string; createdAt: string };

// 고객사 특이사항 메모(이력). 상단 추가 폼 + 최신순 메모 카드 목록. 입력·수정은 이 화면에서만 한다.
export function ClientMemoSection({ clientId, memos }: { clientId: string; memos: MemoItem[] }) {
  const [state, formAction] = useActionState(createClientMemoAction, OK);
  const formRef = useRef<HTMLFormElement>(null);
  // 추가 성공 시 입력란을 비워 다음 메모 입력을 준비한다.
  useEffect(() => {
    if (state.ok && state.message) formRef.current?.reset();
  }, [state]);

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-base font-semibold">특이사항 메모</h2>
      <form
        ref={formRef}
        action={formAction}
        className="mb-3 rounded-[14px] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-4"
      >
        <input type="hidden" name="clientId" value={clientId} />
        <textarea
          name="content"
          rows={3}
          className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm focus:border-[var(--color-primary)] focus:outline-none"
          placeholder="예) 고객사 자체에서 EAP 도입만 했지 실질적 운영은 하지 않으려 함"
        />
        <div className="mt-2 flex items-center justify-end gap-2">
          {state.ok && state.message && <span className="mr-auto text-sm text-[var(--color-primary)]">{state.message}</span>}
          {!state.ok && state.error && <span className="mr-auto text-sm text-[var(--color-danger)]">{state.error}</span>}
          <button type="submit" className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white">
            메모 추가
          </button>
        </div>
      </form>

      {memos.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)]">등록된 메모가 없습니다.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {memos.map((m) => (
            <ClientMemoCard key={m.id} clientId={clientId} memo={m} />
          ))}
        </ul>
      )}
    </section>
  );
}
