"use client";

import { useActionState, useEffect } from "react";
import type { AppRole } from "@/lib/auth/rbac";
import { roleLabel, statusLabel } from "@/lib/labels";
import { OK } from "@/lib/action-state";
import { approveUser, changeStatus, hardDeleteUser } from "./actions";
import { TeamPartFields } from "./TeamPartFields";

export type EditUser = {
  id: string;
  name: string | null;
  email: string;
  role: AppRole | null;
  teamId: string | null;
  partId: string | null;
  status: "ACTIVE" | "PENDING" | "INACTIVE";
};
type Team = { id: string; name: string };
type Part = { id: string; name: string; teamId: string };

const statusStyle: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700",
  PENDING: "bg-amber-50 text-amber-700",
  INACTIVE: "bg-slate-100 text-slate-500",
};

// 편집 드로어 호스트: editing이 없으면 아무것도 렌더하지 않는다. editing이 바뀔 때마다 내부 폼을
// key로 다시 마운트해, useActionState 상태(이전 성공 메시지 등)가 새 대상에 새어 나오지 않게 한다.
export function UserEditPanel({
  editing, teams, parts, onClose,
}: {
  editing: EditUser | null;
  teams: Team[];
  parts: Part[];
  onClose: () => void;
}) {
  if (!editing) return null;
  return <EditDrawer key={editing.id} user={editing} teams={teams} parts={parts} onClose={onClose} />;
}

function EditDrawer({
  user, teams, parts, onClose,
}: {
  user: EditUser;
  teams: Team[];
  parts: Part[];
  onClose: () => void;
}) {
  const [saveState, saveAction] = useActionState(approveUser, OK);
  const [statusState, statusAction] = useActionState(changeStatus, OK);
  const [deleteState, deleteAction] = useActionState(hardDeleteUser, OK);

  // 성공(초기 OK엔 message 없음, 성공 시 SAVED로 message 생김) 시 드로어를 닫는다.
  useEffect(() => {
    if (saveState.message || statusState.message || deleteState.message) onClose();
  }, [saveState, statusState, deleteState, onClose]);

  // Esc로 닫기.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const error = (!saveState.ok && saveState.error) || (!statusState.ok && statusState.error) || (!deleteState.ok && deleteState.error);
  const selectCls =
    "min-h-[44px] rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-primary)]";

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/35"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edName"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <aside className="flex h-full w-full max-w-[400px] flex-col gap-5 overflow-y-auto bg-[var(--color-surface)] p-7 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="edName" className="text-lg font-semibold">{user.name ?? user.email}</h2>
            <p className="text-[13px] text-[var(--color-muted)]">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
          </button>
        </div>
        <span className={`inline-block w-fit rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle[user.status]}`}>
          {statusLabel(user.status)}
        </span>

        {error && <p className="rounded-[10px] bg-rose-50 px-3 py-2 text-sm text-[var(--color-danger)]">{error}</p>}

        {/* 역할·팀·파트 저장(+승인). 팀·파트 select는 TeamPartFields 재사용. */}
        <form action={saveAction} className="flex flex-1 flex-col gap-4">
          <input type="hidden" name="userId" value={user.id} />
          <label className="flex flex-col gap-1.5 text-[13px] text-[var(--color-muted)]">
            역할
            <select name="role" defaultValue={user.role ?? "PM"} className={selectCls}>
              <option value="SUPER_ADMIN">{roleLabel("SUPER_ADMIN")}</option>
              <option value="ADMIN">{roleLabel("ADMIN")}</option>
              <option value="PART_LEADER">{roleLabel("PART_LEADER")}</option>
              <option value="SETTLEMENT">{roleLabel("SETTLEMENT")}</option>
              <option value="PM">{roleLabel("PM")}</option>
            </select>
          </label>
          {/* 팀·파트: TeamPartFields(팀 select + 파트 select 한 쌍) 재사용. 드로어에선 세로로 꽉 차게. */}
          <div className="flex flex-col gap-1.5 text-[13px] text-[var(--color-muted)]">
            팀 · 파트
            <div className="flex flex-col gap-3 [&_select]:min-h-[44px] [&_select]:w-full">
              <TeamPartFields
                teams={teams}
                parts={parts}
                defaultTeamId={user.teamId ?? ""}
                defaultPartId={user.partId ?? ""}
              />
            </div>
          </div>
          <p className="text-xs leading-relaxed text-[var(--color-muted)]">
            팀은 팀 관리자·파트장·PM에게만 적용됩니다. 최고관리자·정산담당자는 전체 접근이라 팀이 무시됩니다.
          </p>

          <div className="mt-auto flex flex-col gap-2.5">
            <button type="submit" className="min-h-[44px] rounded-[10px] bg-[var(--color-primary)] font-semibold text-white">
              {user.status === "ACTIVE" ? "저장" : "저장하고 활성화"}
            </button>
          </div>
        </form>

        {/* 비활성화 / 삭제는 별도 폼(각자 useActionState). 성공 시 공통 effect가 드로어를 닫는다. */}
        {user.status === "ACTIVE" && (
          <form action={statusAction}>
            <input type="hidden" name="userId" value={user.id} />
            <input type="hidden" name="status" value="INACTIVE" />
            <button type="submit" className="min-h-[44px] w-full rounded-[10px] border border-[var(--color-border)]">비활성화</button>
          </form>
        )}
        {user.status === "INACTIVE" && (
          <form
            action={deleteAction}
            onSubmit={(e) => {
              if (!confirm(`'${user.email}' 계정을 완전히 삭제하시겠습니까?\n되돌릴 수 없습니다.`)) e.preventDefault();
            }}
          >
            <input type="hidden" name="userId" value={user.id} />
            <button type="submit" className="min-h-[44px] w-full rounded-[10px] border border-rose-200 text-rose-600">계정 삭제</button>
          </form>
        )}
      </aside>
    </div>
  );
}
