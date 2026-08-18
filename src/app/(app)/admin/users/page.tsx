import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { roleLabel, statusLabel } from "@/lib/labels";
import { approveUser, changeStatus } from "./actions";

export default async function AdminUsersPage() {
  await requireRole("SUPER_ADMIN");
  const [users, teams] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.team.findMany({ orderBy: { name: "asc" } }),
  ]);
  const teamName = new Map(teams.map((t) => [t.id, t.name]));

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
              <td>{statusLabel(u.status)}</td>
              <td className="flex gap-2 py-2">
                <form action={approveUser} className="flex gap-1">
                  <input type="hidden" name="userId" value={u.id} />
                  <select name="role" defaultValue={u.role ?? "PM"} className="border border-[var(--color-border)] rounded px-1">
                    <option value="SUPER_ADMIN">최고관리자</option>
                    <option value="ADMIN">팀 관리자</option>
                    <option value="SETTLEMENT">정산담당자</option>
                    <option value="PM">PM</option>
                  </select>
                  {/* 팀은 팀 관리자·PM에게 의미가 있다(최고관리자·정산담당자는 전체 접근이라 무시됨). */}
                  <select name="teamId" defaultValue={u.teamId ?? ""} className="border border-[var(--color-border)] rounded px-1">
                    <option value="">팀 없음</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
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
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
