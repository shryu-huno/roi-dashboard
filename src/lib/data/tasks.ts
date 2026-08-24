import { withRLS, type RlsContext } from "@/lib/rls";
import type { ActionState } from "@/lib/action-state";

// 과업 금액 필드(생성·수정 공용). 계약금은 단가×횟수 파생 또는 수동값.
type TaskAmounts = {
  name: string;
  unitPrice: number;
  contractCount?: number | null;
  contractAmount?: number | null;
  vatExempt?: boolean;
};

export type TaskInput = TaskAmounts & {
  clientId: string; // 비정규화(RLS·고객사 단위 집계용). 항상 project.clientId와 동일.
  projectId: string;
};

// 수정은 과업이 소속 프로젝트를 옮기지 않으므로 clientId/projectId가 필요 없다.
export type TaskUpdateInput = TaskAmounts;

// 계약금은 단가×횟수로 파생한다(횟수 미입력이면 null).
function deriveContractAmount(unitPrice: number, contractCount: number | null | undefined): number | null {
  return contractCount == null ? null : unitPrice * contractCount;
}

// 사용자가 계약금을 직접 입력했으면 그 값을, 아니면(빈칸) 단가×횟수 자동값을 쓴다.
export function resolveContractAmount(input: TaskAmounts): number | null {
  return input.contractAmount ?? deriveContractAmount(input.unitPrice, input.contractCount);
}

// 고객사 단위 과업 조회. period가 주어지면 그 연·월(달)을 계약기간에 포함하는 프로젝트의
// 과업만 반환한다(실적 입력 화면용). period 미전달이면 모든 프로젝트의 과업을 반환한다.
// 계약 시작/종료일이 비어있으면(열린 구간) 해당 방향 제약은 걸지 않는다.
// 설정 화면은 프로젝트별 과업을 listProjects의 include로 로드하므로 이 함수를 쓰지 않는다.
export function listTasks(ctx: RlsContext, clientId: string, period?: { year: number; month: number }) {
  let projectFilter = {};
  if (period) {
    const monthStart = new Date(Date.UTC(period.year, period.month - 1, 1));
    const monthEnd = new Date(Date.UTC(period.year, period.month, 0, 23, 59, 59, 999));
    projectFilter = {
      project: {
        AND: [
          { OR: [{ contractStart: null }, { contractStart: { lte: monthEnd } }] },
          { OR: [{ contractEnd: null }, { contractEnd: { gte: monthStart } }] },
        ],
      },
    };
  }
  return withRLS(ctx, (tx) => tx.task.findMany({ where: { clientId, ...projectFilter }, orderBy: { name: "asc" } }));
}

export function createTask(ctx: RlsContext, input: TaskInput) {
  return withRLS(ctx, (tx) =>
    tx.task.create({
      data: {
        clientId: input.clientId,
        projectId: input.projectId,
        name: input.name,
        unitPrice: input.unitPrice,
        contractCount: input.contractCount ?? null,
        contractAmount: resolveContractAmount(input),
        vatExempt: input.vatExempt ?? false,
      },
    }),
  );
}

export async function updateTask(ctx: RlsContext, id: string, input: TaskUpdateInput): Promise<ActionState> {
  const result = await withRLS(ctx, (tx) =>
    tx.task.updateMany({
      where: { id },
      data: {
        name: input.name,
        unitPrice: input.unitPrice,
        contractCount: input.contractCount ?? null,
        contractAmount: resolveContractAmount(input),
        vatExempt: input.vatExempt ?? false,
      },
    }),
  );
  if (result.count === 0) return { ok: false, error: "과업을 찾을 수 없거나 권한이 없습니다." };
  return { ok: true };
}

export async function deleteTask(ctx: RlsContext, id: string): Promise<ActionState> {
  const result = await withRLS(ctx, (tx) => tx.task.deleteMany({ where: { id } }));
  if (result.count === 0) return { ok: false, error: "과업을 찾을 수 없거나 권한이 없습니다." };
  return { ok: true };
}
