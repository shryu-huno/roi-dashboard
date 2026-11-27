import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { roleLabel, statusLabel } from "@/lib/labels";
import { UserAdminProvider } from "./UserAdminProvider";
import { OrgTree, type TreeCounts } from "./OrgTree";
import { GroupHeader } from "./GroupHeader";
import { EditUserButton } from "./EditUserButton";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string; part?: string; status?: string }>;
}) {
  await requireRole("SUPER_ADMIN");
  const sp = await searchParams;
  const [users, teams, parts] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.team.findMany({
      orderBy: { name: "asc" },
      include: { parts: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } },
    }),
    prisma.part.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);

  // 선택 키: 전체=all, 승인대기=pending, 팀 미배정=unassigned, 그 외엔 teamId/partId.
  const sel =
    sp.status === "pending" ? "pending"
    : sp.team === "none" ? "unassigned"
    : sp.part ? sp.part
    : sp.team ? sp.team
    : "all";

  // 트리/표 집계는 승인 대기를 제외한 "배정된" 구성원(ACTIVE·INACTIVE)만 센다(목업과 동일).
  const isActiveMember = (u: (typeof users)[number]) => u.status !== "PENDING";
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const partName = new Map(parts.map((p) => [p.id, p.name]));

  const counts: TreeCounts = {
    total: users.length,
    pending: users.filter((u) => u.status === "PENDING").length,
    unassigned: users.filter((u) => !u.teamId && isActiveMember(u)).length,
    team: Object.fromEntries(teams.map((t) => [t.id, users.filter((u) => u.teamId === t.id && isActiveMember(u)).length])),
    part: Object.fromEntries(parts.map((p) => [p.id, users.filter((u) => u.partId === p.id && isActiveMember(u)).length])),
  };

  // 파트장 = 파트 소속 활성 PART_LEADER(파트당 1명). 헤더의 "파트장" 표시에 쓴다.
  const leaderNames: Record<string, string> = Object.fromEntries(
    users
      .filter((u) => u.status === "ACTIVE" && u.role === "PART_LEADER" && u.partId)
      .map((u) => [u.partId as string, u.name ?? u.email]),
  );

  const filteredUsers =
    sel === "pending" ? users.filter((u) => u.status === "PENDING")
    : sel === "unassigned" ? users.filter((u) => !u.teamId && isActiveMember(u))
    : parts.some((p) => p.id === sel) ? users.filter((u) => u.partId === sel && isActiveMember(u))
    : teams.some((t) => t.id === sel) ? users.filter((u) => u.teamId === sel && isActiveMember(u))
    : users;

  const treeTeams = teams.map((t) => ({ id: t.id, name: t.name, parts: t.parts.map((p) => ({ id: p.id, name: p.name })) }));
  const thCls = "px-4 py-4 text-left text-sm font-bold text-[var(--color-muted)] whitespace-nowrap";
  const tdCls = "px-4 py-3 align-middle whitespace-nowrap";
  const statusStyle: Record<string, string> = {
    ACTIVE: "bg-emerald-50 text-emerald-700",
    PENDING: "bg-amber-50 text-amber-700",
    INACTIVE: "bg-slate-100 text-slate-500",
  };

  return (
    <UserAdminProvider
      teams={teams.map((t) => ({ id: t.id, name: t.name }))}
      parts={parts.map((p) => ({ id: p.id, name: p.name, teamId: p.teamId }))}
    >
      <div className="mb-5 flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold">유저 관리</h1>
        <span className="text-sm text-[var(--color-muted)]">
          전체 {users.length}명 · 승인 대기 {counts.pending}명 · 팀 {teams.length}개
        </span>
      </div>

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <aside className="w-full lg:w-[260px] lg:shrink-0">
          <OrgTree sel={sel} teams={treeTeams} counts={counts} />
        </aside>

        <section aria-label="구성원" className="flex min-w-0 flex-1 flex-col gap-4">
          <GroupHeader sel={sel} teams={treeTeams} counts={counts} leaderNames={leaderNames} />

          <div className="overflow-x-auto rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  <th className={thCls}>이름</th>
                  <th className={thCls}>역할</th>
                  <th className={thCls}>팀 · 파트</th>
                  <th className={thCls}>상태</th>
                  <th className={`${thCls} w-[1%] text-right`}>작업</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => {
                  const teamPart = u.teamId
                    ? `${teamName.get(u.teamId) ?? "(삭제된 팀)"}${u.partId ? ` · ${partName.get(u.partId) ?? "(삭제된 파트)"}` : ""}`
                    : "—";
                  return (
                    <tr
                      key={u.id}
                      className={`border-b border-[var(--color-border)] transition-colors last:border-b-0 hover:bg-[var(--color-bg)] ${u.status === "PENDING" ? "bg-amber-50/60" : ""} ${u.status === "INACTIVE" ? "text-[var(--color-muted)]" : ""}`}
                    >
                      <td className={tdCls}>
                        <div className="font-medium">{u.name ?? "-"}</div>
                        <div className="text-xs text-[var(--color-muted)]">{u.email}</div>
                      </td>
                      <td className={tdCls}>{roleLabel(u.role)}</td>
                      <td className={tdCls}>{teamPart}</td>
                      <td className={tdCls}>
                        <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle[u.status]}`}>
                          {statusLabel(u.status)}
                        </span>
                      </td>
                      <td className={`${tdCls} w-[1%] text-right`}>
                        <EditUserButton
                          user={{
                            id: u.id, name: u.name, email: u.email, role: u.role,
                            teamId: u.teamId, partId: u.partId, status: u.status,
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredUsers.length === 0 && (
              <p className="p-8 text-center text-[var(--color-muted)]">이 그룹에 속한 구성원이 없습니다.</p>
            )}
          </div>
        </section>
      </div>
    </UserAdminProvider>
  );
}
