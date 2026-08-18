"use client";

import { useActionState, useState } from "react";
import { updateProjectAction, deleteProjectAction } from "../actions";
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

// 초록(저장)/분홍(삭제) 버튼 — TaskManager와 동일한 디자인 팔레트.
const btnBase =
  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium shadow-sm transition-colors";
const greenBtnCls = `${btnBase} bg-[#57C15E] text-white hover:bg-[#4AAD51]`;
const pinkBtnCls = `${btnBase} bg-[#F2ACB0] text-[#A23B40] hover:bg-[#EC9A9F]`;

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

// 프로젝트 카드. 상태·계약기간·과업은 항상 보이고, 청구·보고 주기 / 실적 계약 / 담당 PM만
// 토글로 접었다 편다(기본 접힘). 접힌 체크박스는 DOM에 남겨(hidden) 저장 시 값이 유실되지 않게 한다.
// 기본정보·주기·실적계약·담당 PM은 하나의 폼으로 상단 "프로젝트 저장" 버튼에서 통합 저장한다.
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
  const [open, setOpen] = useState(false);
  const formId = `project-form-${project.id}`;

  return (
    <section className="mb-4 rounded-[14px] border border-[var(--color-border)] p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-[var(--color-fg)]">프로젝트 - {project.label}</h3>
        <div className="flex items-center gap-2">
          {state.ok && state.message && <span className="text-sm text-[var(--color-primary)]">{state.message}</span>}
          {!state.ok && state.error && <span className="text-sm text-[var(--color-danger)]">{state.error}</span>}
          {/* 통합 저장: 기본정보·주기·실적계약·담당 PM을 한 번에 저장한다(폼은 form 속성으로 연결). */}
          <button type="submit" form={formId} className={greenBtnCls}>
            <CheckIcon />프로젝트 저장
          </button>
          {/* 프로젝트 삭제: PM 이상(자기 담당 고객사). 되돌릴 수 없어 이중 확인한다. */}
          <form
            action={deleteProjectAction}
            onSubmit={(e) => {
              if (
                !confirm(
                  `'${project.label}' 프로젝트를 삭제하시겠습니까?\n이 프로젝트의 과업·실적 등 연관 데이터가 모두 삭제되며 되돌릴 수 없습니다.`,
                )
              ) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="id" value={project.id} />
            <input type="hidden" name="clientId" value={project.clientId} />
            <button type="submit" className={pinkBtnCls}>
              <TrashIcon />프로젝트 삭제
            </button>
          </form>
        </div>
      </div>

      <form id={formId} action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="id" value={project.id} />
        <input type="hidden" name="clientId" value={project.clientId} />

        {/* 항상 보이는 행: 상태 · 계약 기간 */}
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

        {/* 접이 영역(주기·실적계약). 접혀도 DOM 유지(hidden)해 저장 시 값이 유실되지 않는다. */}
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

        {/* 접이 영역(담당 PM): 정산담당자/관리자만. 같은 폼이라 상단 '프로젝트 저장'에 포함된다(저장 시 ClientManager 동기화). */}
        {canManagePms && (
          <div className={open ? "" : "hidden"}>
            <span className="text-sm font-medium text-[var(--color-fg)]">담당 PM (복수 선택)</span>
            <div className="mt-2 grid grid-cols-5 gap-x-4 gap-y-2">
              {pms.map((p) => (
                <label key={p.id} className="flex items-center gap-1.5 text-sm text-[var(--color-fg)]">
                  <input type="checkbox" name="pmIds" value={p.id} defaultChecked={pmIds.includes(p.id)} />
                  {p.label}
                </label>
              ))}
            </div>
          </div>
        )}
      </form>

      <div className="mt-4">
        <TaskManager clientId={project.clientId} projectId={project.id} tasks={tasks} />
      </div>
    </section>
  );
}
