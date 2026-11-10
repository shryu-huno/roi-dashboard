import { Fragment } from "react";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import {
  createTeamAction, renameTeamAction, deleteTeamAction,
  createPartAction, renamePartAction, deletePartAction,
} from "./actions";

export default async function AdminTeamsPage() {
  await requireRole("SUPER_ADMIN");
  const teams = await prisma.team.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { members: true } },
      parts: {
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: {
          _count: { select: { members: true } },
          // 파트장 = 파트 소속 활성 PART_LEADER(파트당 1명).
          members: { where: { role: "PART_LEADER", status: "ACTIVE" }, select: { name: true, email: true } },
        },
      },
    },
  });

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">팀 관리</h1>
      <p className="mb-4 text-sm text-[var(--color-muted)]">
        팀 관리자와 PM을 팀으로 묶습니다. 팀 관리자는 자기 팀 소속 PM이 담당하는 고객사만 열람합니다.
        팀 아래에 파트(1파트·2파트 등)를 만들 수 있습니다.
        사용자별 팀·파트 배정은 <span className="font-medium">사용자 관리</span>에서 합니다.
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
              <Fragment key={t.id}>
              <tr className="border-b border-[var(--color-border)]">
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
              <tr className="border-b border-[var(--color-border)]">
                <td colSpan={3} className="pb-3 pl-6">
                  <div className="mb-1 text-xs text-[var(--color-muted)]">파트</div>
                  {t.parts.length === 0 ? (
                    <p className="mb-2 text-[var(--color-muted)]">등록된 파트가 없습니다.</p>
                  ) : (
                    <ul className="mb-2 space-y-1">
                      {t.parts.map((p) => (
                        <li key={p.id} className="flex items-center gap-2">
                          <form action={renamePartAction} className="flex gap-1">
                            <input type="hidden" name="id" value={p.id} />
                            <input
                              type="text"
                              name="name"
                              defaultValue={p.name}
                              required
                              className="w-40 rounded border border-[var(--color-border)] px-2 py-1"
                            />
                            <button type="submit" className="rounded border border-[var(--color-border)] px-2 py-1">
                              이름변경
                            </button>
                          </form>
                          <span className="text-[var(--color-muted)]">
                            {p._count.members}명 · 파트장 {p.members.length ? p.members.map((m) => m.name ?? m.email).join(", ") : "미지정"}
                          </span>
                          <form action={deletePartAction}>
                            <input type="hidden" name="id" value={p.id} />
                            <button type="submit" className="rounded border border-[var(--color-border)] px-2 py-1 text-[var(--color-danger,#c0392b)]">
                              삭제
                            </button>
                          </form>
                        </li>
                      ))}
                    </ul>
                  )}
                  <form action={createPartAction} className="flex gap-1">
                    <input type="hidden" name="teamId" value={t.id} />
                    <input
                      type="text"
                      name="name"
                      required
                      placeholder="예: 1파트"
                      className="w-40 rounded border border-[var(--color-border)] px-2 py-1"
                    />
                    <button type="submit" className="rounded border border-[var(--color-border)] px-2 py-1">
                      파트 추가
                    </button>
                  </form>
                </td>
              </tr>
              </Fragment>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
