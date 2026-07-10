"use client";

import { useActionState } from "react";
import { updateClientAction } from "../actions";
import { OK } from "@/lib/action-state";

type Pm = { id: string; label: string };
type ClientInit = {
  id: string;
  name: string;
  status: string;
  pmId: string | null;
  industry: string | null;
  contractStart: string; // "yyyy-mm-dd" | ""
  contractEnd: string;
};

const labelCls = "flex flex-col text-xs text-[var(--color-muted)]";
const inputCls = "mt-1 rounded border border-[var(--color-border)] px-3 py-2 text-sm";

export function EditClientForm({ client, pms }: { client: ClientInit; pms: Pm[] }) {
  const [state, formAction] = useActionState(updateClientAction, OK);
  return (
    <form action={formAction} className="mb-6 flex flex-wrap items-end gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <input type="hidden" name="id" value={client.id} />
      <label className={labelCls}>
        고객사명
        <input name="name" required defaultValue={client.name} className={`${inputCls} w-48`} />
      </label>
      <label className={labelCls}>
        상태
        <input name="status" defaultValue={client.status} className={`${inputCls} w-32`} />
      </label>
      <label className={labelCls}>
        담당 PM
        <select name="pmId" defaultValue={client.pmId ?? ""} className={`${inputCls} w-48`}>
          <option value="">미지정</option>
          {pms.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </label>
      <label className={labelCls}>
        업종
        <input name="industry" defaultValue={client.industry ?? ""} className={`${inputCls} w-40`} />
      </label>
      <label className={labelCls}>
        계약 시작
        <input type="date" name="contractStart" defaultValue={client.contractStart} className={inputCls} />
      </label>
      <label className={labelCls}>
        계약 종료
        <input type="date" name="contractEnd" defaultValue={client.contractEnd} className={inputCls} />
      </label>
      <button type="submit" className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white">저장</button>
      {state.ok && state.message && <span className="text-sm text-[var(--color-primary)]">{state.message}</span>}
      {!state.ok && state.error && <span className="text-sm text-[var(--color-danger)]">{state.error}</span>}
    </form>
  );
}
