import { Prisma } from "@prisma/client";
import { withRLS, type RlsContext } from "@/lib/rls";
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
      orderBy: { createdAt: "desc" }, // 최신 프로젝트가 위, 오래된 프로젝트가 아래.
      include: { managers: true, tasks: { orderBy: { name: "asc" } } },
    }),
  );
}

export function getProject(ctx: RlsContext, id: string) {
  return withRLS(ctx, (tx) => tx.project.findUnique({ where: { id }, include: { managers: true } }));
}

export function createProject(ctx: RlsContext, clientId: string, input: ProjectInput) {
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
        managers: input.pmIds?.length ? { create: input.pmIds.map((userId) => ({ userId })) } : undefined,
      },
    });
    await syncClientManagers(tx, clientId);
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
