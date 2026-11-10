import { Prisma } from "@prisma/client";
import { withRLS, type RlsContext } from "@/lib/rls";
import type { ActionState } from "@/lib/action-state";

const DUPLICATE = "이미 같은 이름의 파트가 있습니다.";

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/**
 * PM의 소속 파트장(partLeaderId)을 파트 기준으로 맞춘다.
 * 파트장 권한 RLS(app_can_see_client 등)는 partLeaderId를 기준으로 하므로, 사람 배분은 partId로 하고
 * 이 함수가 partId → partLeaderId를 동기화한다. 파트장 = 그 파트의 활성(ACTIVE) PART_LEADER.
 */
export async function syncPartLeaders(
  tx: Prisma.TransactionClient,
  partIds: (string | null | undefined)[],
): Promise<void> {
  for (const partId of new Set(partIds.filter((id): id is string => !!id))) {
    const leader = await tx.user.findFirst({
      where: { partId, role: "PART_LEADER", status: "ACTIVE" },
      select: { id: true },
    });
    await tx.user.updateMany({
      where: { partId, role: "PM" },
      data: { partLeaderId: leader?.id ?? null },
    });
  }
}

export async function createPart(ctx: RlsContext, teamId: string, rawName: string): Promise<ActionState> {
  const name = rawName.trim();
  if (!name) return { ok: false, error: "파트 이름을 입력하세요." };
  try {
    await withRLS(ctx, async (tx) => {
      const last = await tx.part.aggregate({ where: { teamId }, _max: { sortOrder: true } });
      await tx.part.create({ data: { teamId, name, sortOrder: (last._max.sortOrder ?? 0) + 1 } });
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: DUPLICATE };
    throw e;
  }
  return { ok: true };
}

export async function renamePart(ctx: RlsContext, id: string, rawName: string): Promise<ActionState> {
  const name = rawName.trim();
  if (!name) return { ok: false, error: "파트 이름을 입력하세요." };
  try {
    const count = await withRLS(ctx, async (tx) => (await tx.part.updateMany({ where: { id }, data: { name } })).count);
    if (count === 0) return { ok: false, error: "파트를 찾을 수 없습니다." };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: DUPLICATE };
    throw e;
  }
  return { ok: true };
}

// 파트 삭제: 소속 인원의 partId는 FK(SET NULL)로 해제되지만, PM의 partLeaderId는 FK와 무관하게 남아
// 옛 파트장 권한이 유지되므로 삭제 전에 함께 비운다.
export function deletePart(ctx: RlsContext, id: string): Promise<ActionState> {
  return withRLS(ctx, async (tx) => {
    await tx.user.updateMany({ where: { partId: id, role: "PM" }, data: { partLeaderId: null } });
    const { count } = await tx.part.deleteMany({ where: { id } });
    return count === 0 ? { ok: false, error: "파트를 찾을 수 없습니다." } : { ok: true };
  });
}

// 팀 삭제: 팀의 파트도 Cascade로 지워진다. 그 파트 소속 PM의 partLeaderId를 먼저 비우고, partId도 미리 비운다.
// (한 번의 팀 삭제 안에서 User.teamId·User.partId 해제가 겹치면 PostgreSQL이 partId FK 위반을 내기 때문.)
export function deleteTeam(ctx: RlsContext, id: string): Promise<ActionState> {
  return withRLS(ctx, async (tx) => {
    await tx.user.updateMany({ where: { part: { teamId: id }, role: "PM" }, data: { partLeaderId: null } });
    await tx.user.updateMany({ where: { part: { teamId: id } }, data: { partId: null } });
    const { count } = await tx.team.deleteMany({ where: { id } });
    return count === 0 ? { ok: false, error: "팀을 찾을 수 없습니다." } : { ok: true };
  });
}
