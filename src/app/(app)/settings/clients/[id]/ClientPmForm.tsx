"use client";

import { useActionState } from "react";
import { updateClientPmsAction } from "../actions";
import { OK } from "@/lib/action-state";

type Pm = { id: string; label: string };

export function ClientPmForm({ clientId, pmIds, pms }: { clientId: string; pmIds: string[]; pms: Pm[] }) {
  const [state, formAction] = useActionState(updateClientPmsAction, OK);
  return (
    <form
      action={formAction}
      className="mb-6 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
    >
      <input type="hidden" name="id" value={clientId} />
      <div className="mb-3 flex items-center gap-3">
        <span className="text-sm font-medium text-[var(--color-fg)]">담당 PM (복수 선택)</span>
        <button type="submit" className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white">저장</button>
        {state.ok && state.message && <span className="text-sm text-[var(--color-primary)]">{state.message}</span>}
        {!state.ok && state.error && <span className="text-sm text-[var(--color-danger)]">{state.error}</span>}
      </div>
      <div className="grid grid-cols-5 gap-x-4 gap-y-2">
        {pms.map((p) => (
          <label key={p.id} className="flex items-center gap-1.5 text-sm text-[var(--color-fg)]">
            <input type="checkbox" name="pmIds" value={p.id} defaultChecked={pmIds.includes(p.id)} />
            {p.label}
          </label>
        ))}
      </div>
    </form>
  );
}
