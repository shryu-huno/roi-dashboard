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

  const inputCls =
    "rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm outline-none focus:border-[var(--color-primary)]";
  const lineBtn = "rounded border border-[var(--color-border)] px-3 py-1.5 text-xs";
  const dangerBtn = "rounded border border-[var(--color-danger)] px-3 py-1.5 text-xs text-[var(--color-danger)]";

  return (
    <div>
      <h1 className="mb-2 text-xl font-semibold">팀 관리</h1>
      <p className="mb-4 text-sm text-[var(--color-muted)]">
        팀 관리자와 PM을 팀으로 묶습니다. 팀 관리자는 자기 팀 소속 PM이 담당하는 고객사만 열람합니다.
        팀 아래에 파트(1파트·2파트 등)를 만들 수 있습니다.
        사용자별 팀·파트 배정은 <span className="font-medium">사용자 관리</span>에서 합니다.
      </p>

      <form
        action={createTeamAction}
        className="mb-6 flex flex-wrap items-end gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
      >
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          새 팀 이름
          <input type="text" name="name" required placeholder="예: 1팀" className={`mt-1 w-56 py-2 ${inputCls}`} />
        </label>
        <button type="submit" className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white">
          팀 추가
        </button>
      </form>

      {teams.length === 0 ? (
        <p className="text-[var(--color-muted)]">등록된 팀이 없습니다.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {teams.map((t) => (
            <section
              key={t.id}
              className="overflow-hidden rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)]"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
                <div className="flex items-center gap-3">
                  <form action={renameTeamAction} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={t.id} />
                    <input type="text" name="name" defaultValue={t.name} required className={`w-48 font-semibold ${inputCls}`} />
                    <button type="submit" className={lineBtn}>이름변경</button>
                  </form>
                  <span className="text-sm text-[var(--color-muted)]">소속 {t._count.members}명</span>
                </div>
                <form action={deleteTeamAction}>
                  <input type="hidden" name="id" value={t.id} />
                  <button type="submit" className={dangerBtn}>팀 삭제</button>
                </form>
              </div>

              <div className="px-5 py-4">
                <div className="mb-2 text-sm font-bold text-[var(--color-muted)]">파트</div>
                {t.parts.length === 0 ? (
                  <p className="mb-3 text-sm text-[var(--color-muted)]">등록된 파트가 없습니다.</p>
                ) : (
                  <ul className="mb-3 divide-y divide-[var(--color-border)] rounded-[10px] border border-[var(--color-border)]">
                    {t.parts.map((p) => (
                      <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-3">
                          <form action={renamePartAction} className="flex items-center gap-2">
                            <input type="hidden" name="id" value={p.id} />
                            <input type="text" name="name" defaultValue={p.name} required className={`w-36 ${inputCls}`} />
                            <button type="submit" className={lineBtn}>이름변경</button>
                          </form>
                          <span className="text-sm text-[var(--color-muted)]">
                            {p._count.members}명 · 파트장{" "}
                            <span className="text-[var(--color-fg)]">
                              {p.members.length ? p.members.map((m) => m.name ?? m.email).join(", ") : "미지정"}
                            </span>
                          </span>
                        </div>
                        <form action={deletePartAction}>
                          <input type="hidden" name="id" value={p.id} />
                          <button type="submit" className={dangerBtn}>삭제</button>
                        </form>
                      </li>
                    ))}
                  </ul>
                )}
                <form action={createPartAction} className="flex items-center gap-2">
                  <input type="hidden" name="teamId" value={t.id} />
                  <input type="text" name="name" required placeholder="예: 1파트" className={`w-36 ${inputCls}`} />
                  <button type="submit" className={lineBtn}>파트 추가</button>
                </form>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
