import { withRLS, type RlsContext } from "@/lib/rls";
import type { ActionState } from "@/lib/action-state";

export type PerformanceBatchInput = {
  clientId: string;
  year: number;
  month: number;
  rows: { taskId: string; count: number }[];
};

export function listPerformance(ctx: RlsContext, clientId: string, year: number, month: number) {
  return withRLS(ctx, (tx) =>
    tx.monthlyPerformance.findMany({ where: { year, month, task: { clientId } } }),
  );
}

const FORBIDDEN = "FORBIDDEN_OR_MISSING_TASK";

export function upsertPerformanceBatch(ctx: RlsContext, input: PerformanceBatchInput): Promise<ActionState> {
  return withRLS(ctx, async (tx) => {
    for (const row of input.rows) {
      const task = await tx.task.findUnique({ where: { id: row.taskId } });
      // task가 null이면: 존재하지 않거나 RLS가 은닉(타 고객사) → 위조로 간주하고 전체 롤백.
      if (!task || task.clientId !== input.clientId) throw new Error(FORBIDDEN);
      const amount = task.unitPrice * row.count;
      await tx.monthlyPerformance.upsert({
        where: { taskId_year_month: { taskId: row.taskId, year: input.year, month: input.month } },
        create: { taskId: row.taskId, year: input.year, month: input.month, count: row.count, amount },
        update: { count: row.count, amount },
      });
    }
    return { ok: true } as ActionState;
  }).catch((e: unknown) => {
    if (e instanceof Error && e.message === FORBIDDEN) {
      return { ok: false, error: "과업을 찾을 수 없거나 권한이 없습니다." };
    }
    throw e;
  });
}
