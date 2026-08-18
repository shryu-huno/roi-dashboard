import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { createTeamAction, renameTeamAction, deleteTeamAction } from "./actions";

export default async function AdminTeamsPage() {
  await requireRole("SUPER_ADMIN");
  const teams = await prisma.team.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { members: true } } },
  });

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">팀 관리</h1>
      <p className="mb-4 text-sm text-[var(--color-muted)]">
        팀 관리자와 PM을 팀으로 묶습니다. 팀 관리자는 자기 팀 소속 PM이 담당하는 고객사만 열람합니다.
        사용자별 팀 배정은 <span className="font-medium">사용자 관리</span>에서 합니다.
      </p>

      <form action={createTeamAction} className="mb-6 flex items-end gap-2">
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          새 팀 이름
          <input
            type="text"
            name="name"
            required
            placeholder="예: 1팀"
            className="mt-1 w-56 rounded border border-[var(--color-border)] px-3 py-2 text-sm"
          />
        </label>
        <button type="submit" className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white">
          팀 추가
        </button>
      </form>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
            <th className="py-2">팀 이름</th>
            <th>소속 인원</th>
            <th>작업</th>
          </tr>
        </thead>
        <tbody>
          {teams.length === 0 ? (
            <tr>
              <td colSpan={3} className="py-4 text-[var(--color-muted)]">등록된 팀이 없습니다.</td>
            </tr>
          ) : (
            teams.map((t) => (
              <tr key={t.id} className="border-b border-[var(--color-border)]">
                <td className="py-2">
                  <form action={renameTeamAction} className="flex gap-1">
                    <input type="hidden" name="id" value={t.id} />
                    <input
                      type="text"
                      name="name"
                      defaultValue={t.name}
                      required
                      className="w-48 rounded border border-[var(--color-border)] px-2 py-1"
                    />
                    <button type="submit" className="rounded border border-[var(--color-border)] px-2 py-1">
                      이름변경
                    </button>
                  </form>
                </td>
                <td>{t._count.members}명</td>
                <td>
                  <form action={deleteTeamAction}>
                    <input type="hidden" name="id" value={t.id} />
                    <button type="submit" className="rounded border border-[var(--color-border)] px-2 py-1 text-[var(--color-danger,#c0392b)]">
                      삭제
                    </button>
                  </form>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
