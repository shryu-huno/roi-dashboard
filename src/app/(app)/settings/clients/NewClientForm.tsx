"use client";

import { useActionState } from "react";
import { createClientAction } from "./actions";
import { OK } from "@/lib/action-state";

export function NewClientForm() {
  const [state, formAction] = useActionState(createClientAction, OK);
  // 담당 PM·주기·계약기간은 고객사 생성 후 상세 화면에서 프로젝트를 추가하며 지정한다.
  return (
    <form action={formAction} className="mb-6 flex flex-wrap items-end gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <label className="flex flex-col text-xs text-[var(--color-muted)]">
        고객사명
        <input name="name" required className="mt-1 w-48 rounded border border-[var(--color-border)] px-3 py-2 text-sm" />
      </label>
      <label className="flex flex-col text-xs text-[var(--color-muted)]">
        사업자 구분
        <select name="businessType" className="mt-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-fg)]">
          <option value="">선택 안 함</option>
          <option value="휴노">휴노</option>
          <option value="휴노INC">휴노INC</option>
        </select>
      </label>
      <label className="flex flex-col text-xs text-[var(--color-muted)]">
        업종
        <input name="industry" className="mt-1 w-40 rounded border border-[var(--color-border)] px-3 py-2 text-sm" />
      </label>
      <button type="submit" className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white">고객사 추가</button>
      {state.ok && state.message && <span className="text-sm text-[var(--color-primary)]">{state.message}</span>}
      {!state.ok && state.error && <span className="text-sm text-[var(--color-danger)]">{state.error}</span>}
    </form>
  );
}
