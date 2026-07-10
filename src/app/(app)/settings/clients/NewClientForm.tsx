"use client";

import { useActionState } from "react";
import { createClientAction } from "./actions";
import { OK } from "@/lib/action-state";

type Pm = { id: string; label: string };

export function NewClientForm({ pms }: { pms: Pm[] }) {
  const [state, formAction] = useActionState(createClientAction, OK);
  return (
    <form action={formAction} className="mb-6 flex flex-wrap items-end gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <label className="flex flex-col text-xs text-[var(--color-muted)]">
        고객사명
        <input name="name" required className="mt-1 w-48 rounded border border-[var(--color-border)] px-3 py-2 text-sm" />
      </label>
      <label className="flex flex-col text-xs text-[var(--color-muted)]">
        담당 PM
        <select name="pmId" defaultValue="" className="mt-1 w-48 rounded border border-[var(--color-border)] px-3 py-2 text-sm">
          <option value="">미지정</option>
          {pms.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col text-xs text-[var(--color-muted)]">
        업종
        <input name="industry" className="mt-1 w-40 rounded border border-[var(--color-border)] px-3 py-2 text-sm" />
      </label>
      <label className="flex flex-col text-xs text-[var(--color-muted)]">
        계약 시작
        <input type="date" name="contractStart" className="mt-1 rounded border border-[var(--color-border)] px-3 py-2 text-sm" />
      </label>
      <label className="flex flex-col text-xs text-[var(--color-muted)]">
        계약 종료
        <input type="date" name="contractEnd" className="mt-1 rounded border border-[var(--color-border)] px-3 py-2 text-sm" />
      </label>
      <button type="submit" className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white">고객사 추가</button>
      {state.ok && state.message && <span className="text-sm text-[var(--color-primary)]">{state.message}</span>}
      {!state.ok && state.error && <span className="text-sm text-[var(--color-danger)]">{state.error}</span>}
    </form>
  );
}
