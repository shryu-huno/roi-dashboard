import Link from "next/link";
import {
  renameTeamAction, deleteTeamAction, createPartAction, renamePartAction, deletePartAction,
} from "../teams/actions";
import type { TreeCounts } from "./OrgTree";

type HeaderTeam = { id: string; name: string; parts: { id: string; name: string }[] };

const inputCls =
  "rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm outline-none focus:border-[var(--color-primary)]";
const lineBtn = "rounded border border-[var(--color-border)] px-3 py-1.5 text-xs";
const dangerBtn = "rounded border border-[var(--color-danger)] px-3 py-1.5 text-xs text-[var(--color-danger)]";

// 선택된 그룹의 헤더(서버 렌더). 팀·파트 관리(이름변경/추가/삭제)는 기존 teams/actions.ts를 그대로 쓴다.
// 실패(중복 이름 등)는 현 팀 관리 화면과 동일하게 오류 화면(error.tsx)으로 알린다.
export function GroupHeader({
  sel, teams, counts, leaderNames,
}: {
  sel: string;
  teams: HeaderTeam[];
  counts: TreeCounts;
  leaderNames: Record<string, string>;
}) {
  if (sel === "all") {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">전체 구성원</h2>
        {counts.pending > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
            <span>승인을 기다리는 사용자가 {counts.pending}명 있어요. 역할과 팀을 정해 활성화해 주세요.</span>
            <Link href="/admin/users?status=pending" className="rounded-lg bg-amber-700 px-3.5 py-2 text-[13px] text-white">
              대기 목록 보기
            </Link>
          </div>
        )}
      </div>
    );
  }

  if (sel === "pending") {
    return (
      <div>
        <h2 className="text-lg font-semibold">승인 대기</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Google 계정(@huno.kr)으로 처음 로그인한 사용자입니다. 승인하면서 역할과 팀·파트를 함께 지정합니다.
        </p>
      </div>
    );
  }

  if (sel === "unassigned") {
    return (
      <div>
        <h2 className="text-lg font-semibold">팀 미배정</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          최고관리자·정산담당자는 전체 접근이라 팀이 없어도 됩니다. PM·파트장은 팀을 배정해 주세요.
        </p>
      </div>
    );
  }

  const team = teams.find((t) => t.id === sel);
  if (team) {
    return (
      <div className="flex flex-col gap-3.5 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <form action={renameTeamAction} className="flex items-center gap-2">
              <input type="hidden" name="id" value={team.id} />
              <input type="text" name="name" defaultValue={team.name} required className={`w-48 font-semibold ${inputCls}`} />
              <button type="submit" className={lineBtn}>이름 변경</button>
            </form>
            <span className="text-sm text-[var(--color-muted)]">
              소속 {counts.team[team.id] ?? 0}명 · 파트 {team.parts.length}개
            </span>
          </div>
          <form action={deleteTeamAction}>
            <input type="hidden" name="id" value={team.id} />
            <button type="submit" className={dangerBtn}>팀 삭제</button>
          </form>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {team.parts.map((p) => (
            <Link
              key={p.id}
              href={`/admin/users?part=${p.id}`}
              className="flex flex-col gap-0.5 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-left text-[13px] hover:border-[var(--color-primary)]"
            >
              <span className="font-semibold">{p.name} · {counts.part[p.id] ?? 0}명</span>
              <span className="text-[var(--color-muted)]">파트장 {leaderNames[p.id] ?? "미지정"}</span>
            </Link>
          ))}
          {/* 파트 추가: createPartAction 재사용 */}
          <form action={createPartAction} className="flex items-center gap-2">
            <input type="hidden" name="teamId" value={team.id} />
            <input type="text" name="name" required placeholder="새 파트 이름" className={`w-36 ${inputCls}`} />
            <button type="submit" className={lineBtn}>+ 파트 추가</button>
          </form>
        </div>
      </div>
    );
  }

  // 파트 선택
  const parent = teams.find((t) => t.parts.some((p) => p.id === sel));
  const part = parent?.parts.find((p) => p.id === sel);
  if (parent && part) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4">
        <div>
          <div className="flex items-baseline gap-1.5">
            <Link href={`/admin/users?team=${parent.id}`} className="text-sm text-[var(--color-primary)] hover:underline">
              {parent.name}
            </Link>
            <span className="text-[var(--color-muted)]">›</span>
            <form action={renamePartAction} className="flex items-center gap-2">
              <input type="hidden" name="id" value={part.id} />
              <input type="text" name="name" defaultValue={part.name} required className={`w-40 text-lg font-semibold ${inputCls}`} />
              <button type="submit" className={lineBtn}>이름 변경</button>
            </form>
          </div>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            소속 {counts.part[part.id] ?? 0}명 · 파트장{" "}
            <strong className="font-semibold text-[var(--color-fg)]">{leaderNames[part.id] ?? "미지정"}</strong>
          </p>
        </div>
        <form action={deletePartAction}>
          <input type="hidden" name="id" value={part.id} />
          <button type="submit" className={dangerBtn}>파트 삭제</button>
        </form>
      </div>
    );
  }

  return null;
}
