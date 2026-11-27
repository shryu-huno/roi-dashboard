import Link from "next/link";
import { createTeamAction } from "../teams/actions";

type TreeTeam = { id: string; name: string; parts: { id: string; name: string }[] };
export type TreeCounts = {
  total: number;
  pending: number;
  unassigned: number;
  team: Record<string, number>;
  part: Record<string, number>;
};

// 조직 트리(서버 렌더). 선택은 URL 쿼리로 반영한다: 전체=/admin/users, 승인대기=?status=pending,
// 팀 미배정=?team=none, 팀=?team=<id>, 파트=?part=<id>.
function treeLink(href: string, active: boolean, label: React.ReactNode, right: React.ReactNode, indent = false) {
  const cls = [
    "flex min-h-[40px] w-full items-center justify-between rounded-lg pr-2.5 text-left text-sm",
    indent ? "pl-6" : "pl-2.5",
    active
      ? "bg-[var(--color-hover)] font-semibold text-blue-700"
      : indent
        ? "hover:bg-[var(--color-bg)]"
        : "font-medium hover:bg-[var(--color-bg)]",
  ].join(" ");
  return (
    <Link href={href} className={cls} aria-current={active ? "true" : undefined}>
      <span>{label}</span>
      {right}
    </Link>
  );
}

export function OrgTree({ sel, teams, counts }: { sel: string; teams: TreeTeam[]; counts: TreeCounts }) {
  const num = (n: number) => <span className="font-normal text-[var(--color-muted)]">{n}</span>;
  return (
    <section
      aria-label="조직"
      className="w-full shrink-0 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
    >
      <div className="flex flex-col gap-0.5">
        {treeLink("/admin/users", sel === "all", "전체 구성원", num(counts.total))}
        {treeLink(
          "/admin/users?status=pending",
          sel === "pending",
          "승인 대기",
          <span className="rounded-full bg-amber-50 px-2 text-xs font-semibold text-amber-700">{counts.pending}</span>,
        )}

        <div className="mx-1 my-2 h-px bg-[var(--color-border)]" />
        <div className="px-2.5 py-1 text-xs font-bold text-[var(--color-muted)]">팀 · 파트</div>

        {teams.map((t) => (
          <div key={t.id} className="flex flex-col gap-0.5">
            {treeLink(`/admin/users?team=${t.id}`, sel === t.id, t.name, num(counts.team[t.id] ?? 0))}
            {t.parts.map((p) =>
              treeLink(`/admin/users?part=${p.id}`, sel === p.id, `└ ${p.name}`, num(counts.part[p.id] ?? 0), true),
            )}
          </div>
        ))}

        {treeLink("/admin/users?team=none", sel === "unassigned", "팀 미배정", num(counts.unassigned))}
      </div>

      {/* 새 팀 추가: createTeamAction 재사용. 실패(빈 이름 등)는 action 내부에서 무시/오류 화면. */}
      <form action={createTeamAction} className="mt-3 flex gap-2">
        <input
          type="text"
          name="name"
          required
          placeholder="새 팀 이름"
          aria-label="새 팀 이름"
          className="min-w-0 flex-1 rounded-[10px] border border-[var(--color-border)] px-3 py-1.5 text-sm outline-none focus:border-[var(--color-primary)]"
        />
        <button type="submit" className="rounded border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-primary)]">
          팀 추가
        </button>
      </form>
    </section>
  );
}
