import { Prisma } from "@prisma/client";
import { withRLS, type RlsContext } from "@/lib/rls";
import { isAllAccess, isTeamAdmin } from "@/lib/auth/rbac";
import type { ActionState } from "@/lib/action-state";

export type ProjectInput = {
  name: string;
  status?: string;
  contractStart?: Date | null;
  contractEnd?: Date | null;
  billingCycle?: string[]; // 청구 주기(복수). 미선택이면 []로 클리어.
  reportCycle?: string[]; // 보고 주기(복수). 미선택이면 []로 클리어.
  performanceContract?: boolean; // 실적 계약 여부(미포함=false).
  pmIds?: string[]; // 담당 PM(여러 명). undefined면 배정을 건드리지 않는다.
};

// 접근 권한(RLS)은 ClientManager(고객사↔PM) 기준을 유지한다. 프로젝트 PM 배정이 접근에
// 반영되도록, ClientManager를 그 고객사의 모든 활성 프로젝트 PM들의 합집합으로 재설정한다.
async function syncClientManagers(tx: Prisma.TransactionClient, clientId: string): Promise<void> {
  const rows = await tx.projectManager.findMany({
    where: { project: { clientId, deletedAt: null } },
    select: { userId: true },
  });
  const userIds = [...new Set(rows.map((r) => r.userId))];
  await tx.clientManager.deleteMany({ where: { clientId } });
  if (userIds.length) {
    await tx.clientManager.createMany({ data: userIds.map((userId) => ({ clientId, userId })) });
  }
}

export function listProjects(ctx: RlsContext, clientId: string) {
  // 보관(소프트 삭제)된 프로젝트는 제외. 각 프로젝트의 담당 PM·과업을 함께 로드한다.
  return withRLS(ctx, (tx) =>
    tx.project.findMany({
      where: { clientId, deletedAt: null },
      // 계약 시작일이 최신인 프로젝트가 위. 시작일 없으면 등록일 최신순.
      orderBy: [{ contractStart: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      include: { managers: true, tasks: { orderBy: { name: "asc" } } },
    }),
  );
}

export function getProject(ctx: RlsContext, id: string) {
  return withRLS(ctx, (tx) => tx.project.findUnique({ where: { id }, include: { managers: true } }));
}

// 담당 PM 배정·ClientManager 동기화는 전체 접근(최고관리자·정산담당자)과 팀 관리자만.
// 팀 관리자는 자기 팀 소속 PM만 배정 가능하며, 그 제약은 ProjectManager·ClientManager의
// RLS WITH CHECK(User.teamId = app.team_id)가 강제한다.
function isPrivileged(ctx: RlsContext): boolean {
  return isAllAccess(ctx.role) || isTeamAdmin(ctx.role);
}

export function createProject(ctx: RlsContext, clientId: string, input: ProjectInput) {
  // PM이 만든 프로젝트는 담당 PM 배정 없이 생성된다. PM은 이미 고객사 담당(ClientManager)이라
  // Project RLS로 접근이 유지되며, ClientManager 동기화(정산/관리자 전용)는 건너뛴다.
  const privileged = isPrivileged(ctx);
  return withRLS(ctx, async (tx) => {
    const project = await tx.project.create({
      data: {
        clientId,
        name: input.name,
        status: input.status ?? "진행중",
        contractStart: input.contractStart ?? null,
        contractEnd: input.contractEnd ?? null,
        billingCycle: input.billingCycle ?? [],
        reportCycle: input.reportCycle ?? [],
        performanceContract: input.performanceContract ?? false,
        managers: privileged && input.pmIds?.length ? { create: input.pmIds.map((userId) => ({ userId })) } : undefined,
      },
    });
    if (privileged) await syncClientManagers(tx, clientId);
    return project;
  });
}

// 프로젝트 기본정보 수정. pmIds가 주어지면 담당 PM도 교체(미포함이면 유지).
export async function updateProject(ctx: RlsContext, id: string, input: ProjectInput): Promise<ActionState> {
  const result = await withRLS(ctx, async (tx) => {
    // RLS로 접근 불가면 null → 손대지 않는다.
    const project = await tx.project.findUnique({ where: { id }, select: { clientId: true } });
    if (!project) return { count: 0 };
    await tx.project.update({
      where: { id },
      data: {
        name: input.name,
        status: input.status,
        contractStart: input.contractStart,
        contractEnd: input.contractEnd,
        billingCycle: input.billingCycle,
        reportCycle: input.reportCycle,
        performanceContract: input.performanceContract,
      },
    });
    if (input.pmIds !== undefined) {
      await tx.projectManager.deleteMany({ where: { projectId: id } });
      if (input.pmIds.length) {
        await tx.projectManager.createMany({ data: input.pmIds.map((userId) => ({ projectId: id, userId })) });
      }
      await syncClientManagers(tx, project.clientId);
    }
    return { count: 1 };
  });
  if (result.count === 0) return { ok: false, error: "프로젝트를 찾을 수 없거나 권한이 없습니다." };
  return { ok: true };
}

// 담당 PM 배정만 교체(다른 필드는 손대지 않는다). ClientManager를 동기화한다.
// 앱 UI는 updateProject로 통합 저장하지만, 테스트 팩토리가 고객사 PM을 직접 설정할 때 사용한다.
export async function updateProjectPms(ctx: RlsContext, id: string, pmIds: string[]): Promise<ActionState> {
  const ok = await withRLS(ctx, async (tx) => {
    const project = await tx.project.findUnique({ where: { id }, select: { clientId: true } });
    if (!project) return false;
    await tx.projectManager.deleteMany({ where: { projectId: id } });
    if (pmIds.length) {
      await tx.projectManager.createMany({ data: pmIds.map((userId) => ({ projectId: id, userId })) });
    }
    await syncClientManagers(tx, project.clientId);
    return true;
  });
  if (!ok) return { ok: false, error: "프로젝트를 찾을 수 없거나 권한이 없습니다." };
  return { ok: true };
}

// 프로젝트 완전 삭제 — 연관 과업·실적·담당 PM이 함께 삭제된다(cascade). 되돌릴 수 없다.
// 삭제 후 남은 프로젝트들의 PM 합집합으로 ClientManager(접근 권한)를 재동기화한다.
export async function deleteProject(ctx: RlsContext, id: string): Promise<ActionState> {
  const privileged = isPrivileged(ctx);
  const ok = await withRLS(ctx, async (tx) => {
    // RLS로 접근 불가면 null → 손대지 않는다.
    const project = await tx.project.findUnique({ where: { id }, select: { clientId: true } });
    if (!project) return false;
    await tx.project.delete({ where: { id } });
    // 과업·실적·담당 PM은 FK cascade로 정리된다. ClientManager 재동기화는 정산/관리자만(PM은 쓰기 불가).
    if (privileged) await syncClientManagers(tx, project.clientId);
    return true;
  });
  if (!ok) return { ok: false, error: "프로젝트를 찾을 수 없거나 권한이 없습니다." };
  return { ok: true };
}

