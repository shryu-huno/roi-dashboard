"use client";

import { useActionState } from "react";
import { updateClientAction } from "../actions";
import { OK } from "@/lib/action-state";
import { STATUS_OPTIONS } from "@/lib/clients/status";

type ClientInit = {
  id: string;
  name: string;
  status: string;
  businessType: string | null;
  industry: string | null;
};

const labelCls = "flex flex-col text-xs text-[var(--color-muted)]";
const inputCls = "mt-1 rounded border border-[var(--color-border)] px-3 py-2 text-sm";

// 고객사 기본정보만. 청구·보고 주기, 계약기간, 실적계약, 담당 PM은 프로젝트 단위로 관리한다.
export function EditClientForm({ client }: { client: ClientInit }) {
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
        <select name="status" defaultValue={client.status} className={`${inputCls} w-32 bg-[var(--color-surface)] text-[var(--color-fg)]`}>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </label>
      <label className={labelCls}>
        사업자 구분
        <select name="businessType" defaultValue={client.businessType ?? ""} className={`${inputCls} bg-[var(--color-surface)] text-[var(--color-fg)]`}>
          <option value="">선택 안 함</option>
          <option value="휴노">휴노</option>
          <option value="휴노INC">휴노INC</option>
        </select>
      </label>
      <label className={labelCls}>
        업종
        <input name="industry" defaultValue={client.industry ?? ""} className={`${inputCls} w-40`} />
      </label>
      <button type="submit" className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white">저장</button>
      {state.ok && state.message && <span className="text-sm text-[var(--color-primary)]">{state.message}</span>}
      {!state.ok && state.error && <span className="text-sm text-[var(--color-danger)]">{state.error}</span>}
    </form>
  );
}
