import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { roleLabel, statusLabel } from "@/lib/labels";
import { approveUser, changeStatus } from "./actions";
import { DeleteUserButton } from "./DeleteUserButton";
import { TeamPartFields } from "./TeamPartFields";

export default async function AdminUsersPage() {
  await requireRole("SUPER_ADMIN");
  const [users, teams, parts] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.team.findMany({ orderBy: { name: "asc" } }),
    prisma.part.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const partName = new Map(parts.map((p) => [p.id, p.name]));
  // 파트장 = 파트 소속 활성 PART_LEADER. 목록의 "파트" 열에 파트 이름과 함께 보여 준다.
  const leaderOfPart = new Map(
    users
      .filter((u) => u.status === "ACTIVE" && u.role === "PART_LEADER" && u.partId)
      .map((u) => [u.partId as string, u.name ?? u.email]),
  );

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">사용자·권한 관리</h1>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
            <th className="py-2">이메일</th>
            <th>이름</th>
            <th>역할</th>
            <th>팀</th>
            <th>파트</th>
            <th>상태</th>
            <th>작업</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-b border-[var(--color-border)]">
              <td className="py-2">{u.email}</td>
              <td>{u.name ?? "-"}</td>
              <td>{roleLabel(u.role)}</td>
              <td>{u.teamId ? teamName.get(u.teamId) ?? "(삭제된 팀)" : "-"}</td>
              <td>
                {u.partId ? (
                  <>
                    {/* 파트 열에는 파트장 이름만 보인다. 파트장이 없으면 파트 이름으로 대신한다. */}
                    {leaderOfPart.get(u.partId) ?? `${partName.get(u.partId) ?? "(삭제된 파트)"} (파트장 미지정)`}
                  </>
                ) : "-"}
              </td>
              <td>{statusLabel(u.status)}</td>
              <td className="flex gap-2 py-2">
                <form action={approveUser} className="flex gap-1">
                  <input type="hidden" name="userId" value={u.id} />
                  <select name="role" defaultValue={u.role ?? "PM"} className="border border-[var(--color-border)] rounded px-1">
                    <option value="SUPER_ADMIN">최고관리자</option>
                    <option value="ADMIN">팀 관리자</option>
                    <option value="PART_LEADER">파트장</option>
                    <option value="SETTLEMENT">정산담당자</option>
                    <option value="PM">PM</option>
                  </select>
                  <TeamPartFields
                    teams={teams.map((t) => ({ id: t.id, name: t.name }))}
                    parts={parts.map((p) => ({ id: p.id, name: p.name, teamId: p.teamId }))}
                    defaultTeamId={u.teamId ?? ""}
                    defaultPartId={u.partId ?? ""}
                  />
                  <button type="submit" className="rounded bg-[var(--color-primary)] px-2 py-1 text-white">
                    {u.status === "ACTIVE" ? "저장" : "활성화"}
                  </button>
                </form>
                {u.status === "ACTIVE" && (
                  <form action={changeStatus}>
                    <input type="hidden" name="userId" value={u.id} />
                    <input type="hidden" name="status" value="INACTIVE" />
                    <button type="submit" className="rounded border border-[var(--color-border)] px-2 py-1">
                      비활성화
                    </button>
                  </form>
                )}
                {u.status === "INACTIVE" && (
                  <DeleteUserButton id={u.id} email={u.email} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
