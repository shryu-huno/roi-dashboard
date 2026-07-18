"use client";

import { useActionState } from "react";
import { updateClientAction } from "../actions";
import { OK } from "@/lib/action-state";
import { CYCLE_VALUES } from "@/lib/clients/summary-view";

type ClientInit = {
  id: string;
  name: string;
  status: string;
  businessType: string | null;
  industry: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  contractStart: string; // "yyyy-mm-dd" | ""
  contractEnd: string;
  billingCycle: string[];
  reportCycle: string[];
};

const labelCls = "flex flex-col text-xs text-[var(--color-muted)]";
const inputCls = "mt-1 rounded border border-[var(--color-border)] px-3 py-2 text-sm";

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
        <input name="status" defaultValue={client.status} className={`${inputCls} w-32`} />
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
      <label className={labelCls}>
        담당자명
        <input name="contactName" defaultValue={client.contactName ?? ""} className={`${inputCls} w-32`} />
      </label>
      <label className={labelCls}>
        담당자 이메일
        <input name="contactEmail" defaultValue={client.contactEmail ?? ""} className={`${inputCls} w-48`} />
      </label>
      <label className={labelCls}>
        담당자 전화
        <input name="contactPhone" defaultValue={client.contactPhone ?? ""} className={`${inputCls} w-36`} />
      </label>
      <label className={labelCls}>
        계약 시작
        <input type="date" name="contractStart" defaultValue={client.contractStart} className={inputCls} />
      </label>
      <label className={labelCls}>
        계약 종료
        <input type="date" name="contractEnd" defaultValue={client.contractEnd} className={inputCls} />
      </label>
      <div className={labelCls}>
        <span>청구 주기 (복수 선택)</span>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {CYCLE_VALUES.map((v) => (
            <label key={v} className="flex items-center gap-1 text-sm text-[var(--color-fg)]">
              <input type="checkbox" name="billingCycle" value={v} defaultChecked={client.billingCycle.includes(v)} />
              {v}
            </label>
          ))}
        </div>
      </div>
      <div className={labelCls}>
        <span>보고 주기 (복수 선택)</span>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {CYCLE_VALUES.map((v) => (
            <label key={v} className="flex items-center gap-1 text-sm text-[var(--color-fg)]">
              <input type="checkbox" name="reportCycle" value={v} defaultChecked={client.reportCycle.includes(v)} />
              {v}
            </label>
          ))}
        </div>
      </div>
      <button type="submit" className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white">저장</button>
      {state.ok && state.message && <span className="text-sm text-[var(--color-primary)]">{state.message}</span>}
      {!state.ok && state.error && <span className="text-sm text-[var(--color-danger)]">{state.error}</span>}
    </form>
  );
}
