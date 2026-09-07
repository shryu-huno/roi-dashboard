import type { Prisma } from "@prisma/client";
import { isTeamAdmin, isPartLeader, type AppRole } from "@/lib/auth/rbac";

/**
 * 담당 PM 후보를 요청자의 스코프로 좁히는 Prisma where 조각.
 * - 전체 접근(최고관리자·정산담당자): 제한 없음.
 * - 팀 관리자: 자기 팀(teamId) 소속만.
 * - 파트장: 자기에게 소속된(partLeaderId=본인) PM만.
 * ClientManager/ProjectManager RLS WITH CHECK의 배정 제약에 더한 서버측 방어다.
 */
export function pmCandidateScope(
  user: { id: string; role: AppRole | null; teamId?: string | null },
): Prisma.UserWhereInput {
  if (isTeamAdmin(user.role)) return { teamId: user.teamId ?? undefined };
  if (isPartLeader(user.role)) return { partLeaderId: user.id };
  return {}; // 전체 접근(및 스코프 불필요한 경우)
}
