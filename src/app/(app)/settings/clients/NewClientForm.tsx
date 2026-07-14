"use client";

import { useActionState, useState } from "react";
import { createClientAction } from "./actions";
import { OK } from "@/lib/action-state";
import { CYCLE_VALUES } from "@/lib/clients/summary-view";

type Pm = { id: string; label: string };

export function NewClientForm({ pms }: { pms: Pm[] }) {
  const [state, formAction] = useActionState(createClientAction, OK);
  // 담당 PM 최소 1명 선택 강제: 미선택이면 추가 버튼을 비활성화한다(서버에서도 재검증).
  const [pmCount, setPmCount] = useState(0);
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
      <div className="flex flex-col text-xs text-[var(--color-muted)]">
        <span>청구 주기 (복수 선택)</span>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {CYCLE_VALUES.map((v) => (
            <label key={v} className="flex items-center gap-1 text-sm text-[var(--color-fg)]">
              <input type="checkbox" name="billingCycle" value={v} />
              {v}
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-col text-xs text-[var(--color-muted)]">
        <span>보고 주기 (복수 선택)</span>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {CYCLE_VALUES.map((v) => (
            <label key={v} className="flex items-center gap-1 text-sm text-[var(--color-fg)]">
              <input type="checkbox" name="reportCycle" value={v} />
              {v}
            </label>
          ))}
        </div>
      </div>
      <label className="flex flex-col text-xs text-[var(--color-muted)]">
        계약 시작
        <input type="date" name="contractStart" className="mt-1 rounded border border-[var(--color-border)] px-3 py-2 text-sm" />
      </label>
      <label className="flex flex-col text-xs text-[var(--color-muted)]">
        계약 종료
        <input type="date" name="contractEnd" className="mt-1 rounded border border-[var(--color-border)] px-3 py-2 text-sm" />
      </label>
      <button
        type="submit"
        disabled={pmCount === 0}
        className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        고객사 추가
      </button>
      {state.ok && state.message && <span className="text-sm text-[var(--color-primary)]">{state.message}</span>}
      {!state.ok && state.error && <span className="text-sm text-[var(--color-danger)]">{state.error}</span>}

      {/* 담당 PM 선택은 버튼 아래 전체 폭 행으로. 한 행에 최대 5명(가나다순). */}
      <div className="w-full text-xs text-[var(--color-muted)]">
        <span>담당 PM</span>
        <div className="mt-1 grid grid-cols-5 gap-x-4 gap-y-2">
          {pms.map((p) => (
            <label key={p.id} className="flex items-center gap-1.5 text-sm text-[var(--color-fg)]">
              <input
                type="checkbox"
                name="pmIds"
                value={p.id}
                onChange={(e) => setPmCount((n) => n + (e.target.checked ? 1 : -1))}
              />
              {p.label}
            </label>
          ))}
        </div>
        {pmCount === 0 && <span className="mt-2 block text-[#B91C1C]">*담당 PM을 1명 이상 선택해주세요.</span>}
      </div>
    </form>
  );
}
