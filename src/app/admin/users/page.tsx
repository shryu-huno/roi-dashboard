import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { roleLabel, statusLabel } from "@/lib/labels";
import { approveUser, changeStatus } from "./actions";

export default async function AdminUsersPage() {
  await requireRole("ADMIN");
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });

  return (
    <main className="p-8">
      <h1 className="mb-4 text-xl font-semibold">사용자·권한 관리</h1>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
            <th className="py-2">이메일</th>
            <th>이름</th>
            <th>역할</th>
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
              <td>{statusLabel(u.status)}</td>
              <td className="flex gap-2 py-2">
                <form action={approveUser} className="flex gap-1">
                  <input type="hidden" name="userId" value={u.id} />
                  <select name="role" defaultValue={u.role ?? "PM"} className="border border-[var(--color-border)] rounded px-1">
                    <option value="ADMIN">관리자</option>
                    <option value="SETTLEMENT">정산담당자</option>
                    <option value="PM">PM</option>
                  </select>
                  <button type="submit" className="rounded bg-[var(--color-primary)] px-2 py-1 text-white">
                    승인/역할부여
                  </button>
                </form>
                <form action={changeStatus}>
                  <input type="hidden" name="userId" value={u.id} />
                  <input type="hidden" name="status" value={u.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"} />
                  <button type="submit" className="rounded border border-[var(--color-border)] px-2 py-1">
                    {u.status === "ACTIVE" ? "비활성화" : "활성화"}
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
