import { Prisma } from "@prisma/client";
import { withRLS, type RlsContext } from "@/lib/rls";
import { isAllAccess, isTeamScoped } from "@/lib/auth/rbac";
import { resolveContractAmount } from "@/lib/data/tasks";
import { recomputePerformanceAmounts } from "@/lib/data/performance";
import type { ProjectTaskItem } from "@/lib/validation/schemas";
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
  tasks?: ProjectTaskItem[]; // 과업 일괄 저장(신규·수정·삭제). undefined면 과업을 건드리지 않는다.
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

// 담당 PM 배정·ClientManager 동기화는 전체 접근(최고관리자·정산담당자)과 팀/파트 단위 관리자
// (팀 관리자·파트장)만. 팀 관리자는 자기 팀, 파트장은 자기 소속 PM만 배정 가능하며, 그 제약은
// ProjectManager·ClientManager의 RLS WITH CHECK(teamId=app.team_id / partLeaderId=app.user_id)가 강제한다.
function isPrivileged(ctx: RlsContext): boolean {
  return isAllAccess(ctx.role) || isTeamScoped(ctx.role);
}

// 고객사 담당 PM(ClientManager) 전체를 프로젝트(ProjectManager)로 승계한다.
// PM이 만든 프로젝트에서 쓰인다: PM은 RLS상 공동 담당 PM을 볼 수 없어 직접 복사할 수 없으므로,
// "사용자가 누구를 고르는" 게 아니라 이미 존재하는 고객사 담당 PM을 그대로 프로젝트로 내리는
// 시스템 동작으로 처리한다. 사용자 입력은 흘러들지 않고, 검증된 clientId/projectId에만 한정된다.
// (clientId는 직전 프로젝트 생성이 PM의 RLS로 검증된 값이다.)
const SYSTEM_CTX: RlsContext = { userId: "__system__", role: "SUPER_ADMIN" };

async function inheritClientManagers(clientId: string, projectId: string): Promise<void> {
  await withRLS(SYSTEM_CTX, async (tx) => {
    const cms = await tx.clientManager.findMany({ where: { clientId }, select: { userId: true } });
    if (cms.length) {
      await tx.projectManager.createMany({
        data: cms.map(({ userId }) => ({ projectId, userId })),
        skipDuplicates: true,
      });
    }
  });
}

export async function createProject(ctx: RlsContext, clientId: string, input: ProjectInput) {
  const privileged = isPrivileged(ctx);
  const project = await withRLS(ctx, async (tx) => {
    const created = await tx.project.create({
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
    if (privileged) {
      // 정산/관리자: 폼에서 고른 담당 PM을 배정하고 ClientManager를 합집합으로 동기화한다.
      await syncClientManagers(tx, clientId);
    } else {
      // PM: RLS상 본인 ClientManager 행만 보이므로, 생성자 본인은 같은 트랜잭션에서 원자적으로 승계한다
      // (projectmanager WITH CHECK가 "그 고객사 담당 PM이면 허용"으로 완화됨). 공동 PM은 아래에서 추가.
      const own = await tx.clientManager.findMany({ where: { clientId }, select: { userId: true } });
      if (own.length) {
        await tx.projectManager.createMany({ data: own.map(({ userId }) => ({ projectId: created.id, userId })) });
      }
    }
    return created;
  });
  // PM은 공동 담당 PM을 볼 수 없으므로, 생성 후 시스템 컨텍스트로 고객사 담당 PM 전체를 승계한다
  // (본인은 위에서 이미 배정됨 → skipDuplicates). ClientManager는 그대로라 동기화 불필요.
  if (!privileged) await inheritClientManagers(clientId, project.id);
  return project;
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
    // 과업 일괄 반영: 상단 '프로젝트 저장'이 과업 신규·수정·삭제를 함께 처리한다.
    // projectId 조건을 함께 걸어 다른 프로젝트의 과업을 건드리지 못하게 한다.
    if (input.tasks !== undefined) {
      for (const t of input.tasks) {
        if (t.deleted) {
          if (t.id) await tx.task.deleteMany({ where: { id: t.id, projectId: id } });
          continue;
        }
        const data = {
          name: t.name,
          unitPrice: t.unitPrice,
          contractCount: t.contractCount ?? null,
          contractAmount: resolveContractAmount(t),
          vatExempt: t.vatExempt ?? false,
        };
        if (t.id) {
          await tx.task.updateMany({ where: { id: t.id, projectId: id }, data });
          // 단가가 바뀌었을 수 있으므로 이 과업의 횟수 모드 실적 금액을 새 단가로 다시 계산한다.
          await recomputePerformanceAmounts(tx, t.id, t.unitPrice);
        } else {
          await tx.task.create({ data: { clientId: project.clientId, projectId: id, ...data } });
        }
      }
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

// 프로젝트 완전 삭제 — 연관 과업·실적·프로젝트 담당 PM(ProjectManager)이 함께 삭제된다(cascade). 되돌릴 수 없다.
// 고객사 담당 PM(ClientManager)은 손대지 않는다: 프로젝트를 지워도 고객사에 배정된 기본 PM의 접근
// 권한은 유지돼야 하기 때문(마지막 프로젝트를 지우면 합집합 재동기화가 기본 PM까지 지워버렸던 문제).
// PM 교체는 프로젝트 수정(updateProject)에서 명시적으로 한다.
export async function deleteProject(ctx: RlsContext, id: string): Promise<ActionState> {
  const ok = await withRLS(ctx, async (tx) => {
    // RLS로 접근 불가면 null → 손대지 않는다.
    const project = await tx.project.findUnique({ where: { id }, select: { id: true } });
    if (!project) return false;
    await tx.project.delete({ where: { id } });
    return true;
  });
  if (!ok) return { ok: false, error: "프로젝트를 찾을 수 없거나 권한이 없습니다." };
  return { ok: true };
}

