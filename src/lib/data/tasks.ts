import { withRLS, type RlsContext } from "@/lib/rls";
import type { ActionState } from "@/lib/action-state";

export type TaskInput = {
  clientId: string;
  name: string;
  unitPrice: number;
  contractAmount?: number | null;
};

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
        contractAmount: input.contractAmount ?? null,
      },
    }),
  );
}

export async function updateTask(ctx: RlsContext, id: string, input: TaskInput): Promise<ActionState> {
  const result = await withRLS(ctx, (tx) =>
    tx.task.updateMany({
      where: { id },
      data: { name: input.name, unitPrice: input.unitPrice, contractAmount: input.contractAmount ?? null },
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
