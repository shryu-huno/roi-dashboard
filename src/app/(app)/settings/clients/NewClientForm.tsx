"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createClientAction } from "./actions";
import { OK } from "@/lib/action-state";

type Pm = { id: string; label: string };

// 필수 항목(고객사명·사업자 구분·담당 PM)의 누락 여부.
type Errors = { name: boolean; businessType: boolean; pm: boolean };
const NO_ERRORS: Errors = { name: false, businessType: false, pm: false };

// 소제목 색: 누락이면 붉은색, 아니면 기본(muted).
const title = (err: boolean) => (err ? "text-[var(--color-danger)]" : "text-[var(--color-muted)]");

export function NewClientForm({ pms }: { pms: Pm[] }) {
  const [state, formAction] = useActionState(createClientAction, OK);
  const formRef = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<Errors>(NO_ERRORS);
  // 추가 성공 시 폼(고객사명·사업자 구분·담당 PM 선택)을 비워 다음 입력을 준비한다.
  // (성공 시점엔 필수 항목이 모두 채워져 errors는 이미 해제된 상태다.)
  useEffect(() => {
    if (state.ok && state.message) formRef.current?.reset();
  }, [state]);
  // 제출 전 필수 항목 확인. 누락이 있으면 액션을 막고 해당 소제목을 붉게 표시한다(서버에서도 재검증).
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    const form = e.currentTarget;
    const name = (form.elements.namedItem("name") as HTMLInputElement).value.trim();
    const businessType = (form.elements.namedItem("businessType") as HTMLSelectElement).value;
    const pmChecked = form.querySelectorAll<HTMLInputElement>('input[name="pmIds"]:checked').length;
    const next: Errors = { name: !name, businessType: !businessType, pm: pmChecked === 0 };
    if (next.name || next.businessType || next.pm) {
      e.preventDefault();
      setErrors(next);
    }
  }
  // 담당 PM은 고객사 담당으로 배정되어 프로젝트·과업을 설정할 수 있다. 주기·계약기간은 상세 화면에서 프로젝트로 지정.
  return (
    <form ref={formRef} action={formAction} onSubmit={handleSubmit} className="mb-6 flex flex-wrap items-end gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <label className={`flex flex-col text-xs ${title(errors.name)}`}>
        고객사명*
        <input
          name="name"
          onChange={() => errors.name && setErrors((e) => ({ ...e, name: false }))}
          className="mt-1 w-48 rounded border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-fg)]"
        />
      </label>
      <label className={`flex flex-col text-xs ${title(errors.businessType)}`}>
        사업자 구분*
        <select
          name="businessType"
          onChange={() => errors.businessType && setErrors((e) => ({ ...e, businessType: false }))}
          className="mt-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-fg)]"
        >
          <option value="">선택 안 함</option>
          <option value="휴노">휴노</option>
          <option value="휴노INC">휴노INC</option>
        </select>
      </label>
      <label className="flex flex-col text-xs text-[var(--color-muted)]">
        업종
        <input name="industry" className="mt-1 w-40 rounded border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-fg)]" />
      </label>
      <button type="submit" className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white">고객사 추가</button>
      {state.ok && state.message && <span className="text-sm text-[var(--color-primary)]">{state.message}</span>}
      {!state.ok && state.error && <span className="text-sm text-[var(--color-danger)]">{state.error}</span>}

      {/* 담당 PM (복수 선택, 최소 1명): 배정하면 해당 PM이 이 고객사의 프로젝트·과업을 설정할 수 있다. */}
      <div className="w-full text-xs">
        <span className={title(errors.pm)}>담당 PM* (복수 선택, 최소 1명)</span>
        <div className="mt-1 grid grid-cols-5 gap-x-4 gap-y-2">
          {pms.map((p) => (
            <label key={p.id} className="flex items-center gap-1.5 text-sm text-[var(--color-fg)]">
              <input type="checkbox" name="pmIds" value={p.id} onChange={() => errors.pm && setErrors((e) => ({ ...e, pm: false }))} />
              {p.label}
            </label>
          ))}
        </div>
      </div>
    </form>
  );
}
