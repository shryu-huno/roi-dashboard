"use client";

import { useActionState, useState } from "react";
import { updateProjectAction, updateProjectPmsAction } from "../actions";
import { OK } from "@/lib/action-state";
import { CYCLE_VALUES } from "@/lib/clients/summary-view";
import { TaskManager } from "./TaskManager";

type Pm = { id: string; label: string };
type Task = { id: string; name: string; unitPrice: number; contractCount: number | null; contractAmount: number | null };

type Project = {
  id: string;
  clientId: string;
  label: string; // 소제목용 연도 라벨(예: "2026", "2025~2026")
  status: string;
  contractStart: string; // "yyyy-mm-dd" | ""
  contractEnd: string;
  billingCycle: string[];
  reportCycle: string[];
  performanceContract: boolean;
};

const labelCls = "flex flex-col text-xs text-[var(--color-muted)]";
const inputCls = "mt-1 rounded border border-[var(--color-border)] px-3 py-2 text-sm";

// 프로젝트 카드. 상태·계약기간·과업은 항상 보이고, 청구·보고 주기 / 실적 계약 / 담당 PM만
// 토글로 접었다 편다(기본 접힘). 접힌 주기 체크박스는 DOM에 남겨(hidden) 저장 시 값이 유실되지 않게 한다.
export function ProjectCard({
  project,
  tasks,
  pms,
  pmIds,
  canManagePms,
}: {
  project: Project;
  tasks: Task[];
  pms: Pm[];
  pmIds: string[];
  canManagePms: boolean;
}) {
  const [state, formAction] = useActionState(updateProjectAction, OK);
  const [pmState, pmFormAction] = useActionState(updateProjectPmsAction, OK);
  const [open, setOpen] = useState(false);

  return (
    <section className="mb-4 rounded-[14px] border border-[var(--color-border)] p-4">
      <h3 className="mb-3 text-base font-semibold text-[var(--color-fg)]">프로젝트 - {project.label}</h3>

      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="id" value={project.id} />
        <input type="hidden" name="clientId" value={project.clientId} />

        {/* 항상 보이는 행: 상태 · 계약 기간 · 저장 */}
        <div className="flex flex-wrap items-end gap-3">
          <label className={labelCls}>
            상태
            <input name="status" defaultValue={project.status} className={`${inputCls} w-28`} />
          </label>
          <label className={labelCls}>
            계약 시작
            <input type="date" name="contractStart" defaultValue={project.contractStart} className={inputCls} />
          </label>
          <label className={labelCls}>
            계약 종료
            <input type="date" name="contractEnd" defaultValue={project.contractEnd} className={inputCls} />
          </label>
          <button type="submit" className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white">저장</button>
          {state.ok && state.message && <span className="text-sm text-[var(--color-primary)]">{state.message}</span>}
          {!state.ok && state.error && <span className="text-sm text-[var(--color-danger)]">{state.error}</span>}
        </div>

        {/* 토글: 청구·보고 주기 / 실적 계약 / 담당 PM */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 self-start text-sm font-medium text-[var(--color-fg)]"
          aria-expanded={open}
        >
          <span className="text-[var(--color-muted)]">{open ? "▾" : "▸"}</span>
          청구·보고 주기 / 실적 계약 / 담당 PM
        </button>

        {/* 접이 영역(주기·실적계약): 같은 폼이라 위 '저장'에 포함된다. 접혀도 DOM 유지(hidden). */}
        <div className={open ? "flex flex-wrap items-end gap-6" : "hidden"}>
          <div className={labelCls}>
            <span>청구 주기 (복수 선택)</span>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
              {CYCLE_VALUES.map((v) => (
                <label key={v} className="flex items-center gap-1 text-sm text-[var(--color-fg)]">
                  <input type="checkbox" name="billingCycle" value={v} defaultChecked={project.billingCycle.includes(v)} />
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
                  <input type="checkbox" name="reportCycle" value={v} defaultChecked={project.reportCycle.includes(v)} />
                  {v}
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-1.5 self-end pb-2 text-sm text-[var(--color-fg)]">
            <input type="checkbox" name="performanceContract" value="true" defaultChecked={project.performanceContract} />
            실적 계약
          </label>
        </div>
      </form>

      {/* 접이 영역(담당 PM): 정산담당자/관리자만. 별도 폼(저장 시 ClientManager 동기화). */}
      {canManagePms && (
        <form action={pmFormAction} className={open ? "mt-4" : "hidden"}>
          <input type="hidden" name="id" value={project.id} />
          <input type="hidden" name="clientId" value={project.clientId} />
          <div className="mb-2 flex items-center gap-3">
            <span className="text-sm font-medium text-[var(--color-fg)]">담당 PM (복수 선택)</span>
            <button type="submit" className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white">저장</button>
            {pmState.ok && pmState.message && <span className="text-sm text-[var(--color-primary)]">{pmState.message}</span>}
            {!pmState.ok && pmState.error && <span className="text-sm text-[var(--color-danger)]">{pmState.error}</span>}
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
      )}

      <div className="mt-4">
        <TaskManager clientId={project.clientId} projectId={project.id} tasks={tasks} />
      </div>
    </section>
  );
}
