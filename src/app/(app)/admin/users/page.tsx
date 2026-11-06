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

  const pendingCount = users.filter((u) => u.status === "PENDING").length;
  const thCls = "px-4 py-4 text-center text-sm font-bold text-[var(--color-muted)] whitespace-nowrap";
  const tdCls = "px-4 py-3 text-center align-middle whitespace-nowrap";
  const statusStyle: Record<string, string> = {
    ACTIVE: "bg-emerald-50 text-emerald-700",
    PENDING: "bg-amber-50 text-amber-700",
    INACTIVE: "bg-slate-100 text-slate-500",
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold">사용자·권한 관리</h1>
        <span className="text-sm text-[var(--color-muted)]">
          전체 {users.length}명{pendingCount > 0 ? ` · 승인 대기 ${pendingCount}명` : ""}
        </span>
      </div>
      <div className="overflow-x-auto rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)]">
        {/* w-full이면 남는 폭이 모든 열에 나뉘어 열 사이가 벌어진다. 내용 폭으로 두고 카드 가운데에 맞춘다. */}
        <table className="mx-auto text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <th className={thCls}>이메일</th>
              <th className={thCls}>이름</th>
              <th className={thCls}>역할</th>
              <th className={thCls}>팀</th>
              <th className={thCls}>파트</th>
              <th className={thCls}>상태</th>
              <th className={thCls}>작업</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr
                key={u.id}
                className={`border-b border-[var(--color-border)] transition-colors last:border-b-0 hover:bg-[var(--color-bg)] ${u.status === "PENDING" ? "bg-amber-50/60" : ""}`}
              >
                <td className={tdCls}>{u.email}</td>
                <td className={tdCls}>{u.name ?? "-"}</td>
                <td className={tdCls}>{roleLabel(u.role)}</td>
                <td className={tdCls}>{u.teamId ? teamName.get(u.teamId) ?? "(삭제된 팀)" : "-"}</td>
                <td className={tdCls}>
                  {/* 파트 열에는 파트장 이름만 보인다. 파트장이 없으면 파트 이름으로 대신한다. */}
                  {u.partId
                    ? leaderOfPart.get(u.partId) ?? `${partName.get(u.partId) ?? "(삭제된 파트)"} (파트장 미지정)`
                    : "-"}
                </td>
                <td className={tdCls}>
                  <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle[u.status]}`}>
                    {statusLabel(u.status)}
                  </span>
                </td>
                <td className={tdCls}>
                  <div className="flex items-center justify-center gap-3">
                    {/* key: 저장 후 React 19가 폼을 초기화하면 select가 "저장 전 값"으로 돌아가므로, 저장된 값이
                        바뀌면 폼을 새로 그려 항상 저장된 값이 보이게 한다. */}
                    <form key={`${u.role}:${u.teamId}:${u.partId}`} action={approveUser} className="flex items-center gap-2">
                      <input type="hidden" name="userId" value={u.id} />
                      <select
                        name="role"
                        defaultValue={u.role ?? "PM"}
                        className="rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm outline-none focus:border-[var(--color-primary)]"
                      >
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
                      <button type="submit" className="rounded bg-[var(--color-primary)] px-3 py-1.5 text-xs text-white">
                        {u.status === "ACTIVE" ? "저장" : "활성화"}
                      </button>
                    </form>
                    {u.status === "ACTIVE" && (
                      <form action={changeStatus}>
                        <input type="hidden" name="userId" value={u.id} />
                        <input type="hidden" name="status" value="INACTIVE" />
                        <button type="submit" className="rounded border border-[var(--color-border)] px-3 py-1.5 text-xs">
                          비활성화
                        </button>
                      </form>
                    )}
                    {u.status === "INACTIVE" && <DeleteUserButton id={u.id} email={u.email} />}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
