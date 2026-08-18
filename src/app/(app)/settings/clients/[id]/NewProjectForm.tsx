"use client";

import { useActionState, useEffect, useRef } from "react";
import { createProjectAction } from "../actions";
import { OK } from "@/lib/action-state";
import { CYCLE_VALUES } from "@/lib/clients/summary-view";

type Pm = { id: string; label: string };

const labelCls = "flex flex-col text-xs text-[var(--color-muted)]";
const inputCls = "mt-1 rounded border border-[var(--color-border)] px-3 py-2 text-sm";

export function NewProjectForm({ clientId, pms, canAssignPms, defaultPmIds = [] }: { clientId: string; pms: Pm[]; canAssignPms: boolean; defaultPmIds?: string[] }) {
  const [state, formAction] = useActionState(createProjectAction, OK);
  const formRef = useRef<HTMLFormElement>(null);
  // 추가 성공 시 폼을 비워 다음 프로젝트 입력을 준비한다.
  useEffect(() => {
    if (state.ok && state.message) formRef.current?.reset();
  }, [state]);
  return (
    <form ref={formRef} action={formAction} className="mb-4 flex flex-wrap items-end gap-3 rounded-[14px] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <input type="hidden" name="clientId" value={clientId} />
      {/* 프로젝트명은 계약 기간 연도로 자동 생성한다(예: 2026년, 2025년~2026년). */}
      <label className={labelCls}>
        계약 시작
        <input type="date" name="contractStart" className={inputCls} />
      </label>
      <label className={labelCls}>
        계약 종료
        <input type="date" name="contractEnd" className={inputCls} />
      </label>
      <div className={labelCls}>
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
      <div className={labelCls}>
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
      <label className="flex items-center gap-1.5 self-end pb-2 text-sm text-[var(--color-fg)]">
        <input type="checkbox" name="performanceContract" value="true" />
        실적 계약
      </label>
      <button type="submit" className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white">프로젝트 추가</button>
      {state.ok && state.message && <span className="text-sm text-[var(--color-primary)]">{state.message}</span>}
      {!state.ok && state.error && <span className="text-sm text-[var(--color-danger)]">{state.error}</span>}

      {/* 담당 PM 배정은 정산/관리자만(RLS 제한). PM은 배정 없이 프로젝트만 추가한다. */}
      {canAssignPms && (
        <div className="w-full text-xs text-[var(--color-muted)]">
          <span>담당 PM (복수 선택)</span>
          <div className="mt-1 grid grid-cols-5 gap-x-4 gap-y-2">
            {pms.map((p) => (
              <label key={p.id} className="flex items-center gap-1.5 text-sm text-[var(--color-fg)]">
                <input type="checkbox" name="pmIds" value={p.id} defaultChecked={defaultPmIds.includes(p.id)} />
                {p.label}
              </label>
            ))}
          </div>
        </div>
      )}
    </form>
  );
}
