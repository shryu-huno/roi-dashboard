import { withRLS, type RlsContext } from "@/lib/rls";
import type { ActionState } from "@/lib/action-state";

export type TaskInput = {
  clientId: string;
  name: string;
  unitPrice: number;
  contractCount?: number | null;
  contractAmount?: number | null;
};

// 계약금은 단가×횟수로 파생한다(횟수 미입력이면 null).
function deriveContractAmount(unitPrice: number, contractCount: number | null | undefined): number | null {
  return contractCount == null ? null : unitPrice * contractCount;
}

// 사용자가 계약금을 직접 입력했으면 그 값을, 아니면(빈칸) 단가×횟수 자동값을 쓴다.
function resolveContractAmount(input: TaskInput): number | null {
  return input.contractAmount ?? deriveContractAmount(input.unitPrice, input.contractCount);
}

export function listTasks(ctx: RlsContext, clientId: string) {
  return withRLS(ctx, (tx) => tx.task.findMany({ where: { clientId }, orderBy: { name: "asc" } }));
}

export function createTask(ctx: RlsContext, input: TaskInput) {
  return withRLS(ctx, (tx) =>
    tx.task.create({
      data: {
        clientId: input.clientId,
        name: input.name,
        unitPrice: input.unitPrice,
        contractCount: input.contractCount ?? null,
        contractAmount: resolveContractAmount(input),
      },
    }),
  );
}

export async function updateTask(ctx: RlsContext, id: string, input: TaskInput): Promise<ActionState> {
  const result = await withRLS(ctx, (tx) =>
    tx.task.updateMany({
      where: { id },
      data: {
        name: input.name,
        unitPrice: input.unitPrice,
        contractCount: input.contractCount ?? null,
        contractAmount: resolveContractAmount(input),
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
