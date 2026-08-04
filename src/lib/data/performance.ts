import { withRLS, type RlsContext } from "@/lib/rls";
import type { ActionState } from "@/lib/action-state";

export type PerformanceBatchInput = {
  clientId: string;
  year: number;
  month: number;
  // 과업별 택일: count(횟수 모드) 또는 amount(금액 직접입력 모드) 중 정확히 한쪽만 non-null.
  rows: { taskId: string; count: number | null; amount: number | null }[];
};

export function listPerformance(ctx: RlsContext, clientId: string, year: number, month: number) {
  return withRLS(ctx, (tx) =>
    tx.monthlyPerformance.findMany({ where: { year, month, task: { clientId } } }),
  );
}

// 계약 기간 전체(연/월 무관) 과업별 누적 횟수·금액. Plan 3 집계의 조회 기반이기도 하다.
export type PerformanceTotal = { taskId: string; totalCount: number; totalAmount: number };

export async function listPerformanceTotals(ctx: RlsContext, clientId: string): Promise<PerformanceTotal[]> {
  const grouped = await withRLS(ctx, (tx) =>
    tx.monthlyPerformance.groupBy({
      by: ["taskId"],
      where: { task: { clientId } },
      _sum: { count: true, amount: true },
    }),
  );
  return grouped.map((g) => ({
    taskId: g.taskId,
    totalCount: g._sum.count ?? 0,
    totalAmount: g._sum.amount ?? 0,
  }));
}

const FORBIDDEN = "FORBIDDEN_OR_MISSING_TASK";

export function upsertPerformanceBatch(ctx: RlsContext, input: PerformanceBatchInput): Promise<ActionState> {
  return withRLS(ctx, async (tx) => {
    for (const row of input.rows) {
      const task = await tx.task.findUnique({ where: { id: row.taskId } });
      // task가 null이면: 존재하지 않거나 RLS가 은닉(타 고객사) → 위조로 간주하고 전체 롤백.
      if (!task || task.clientId !== input.clientId) throw new Error(FORBIDDEN);
      // 금액 모드: 입력 금액 저장, count는 null. 횟수 모드: 단가×횟수로 금액 파생.
      const count = row.count;
      const amount = row.amount != null ? row.amount : task.unitPrice * (row.count as number);
      await tx.monthlyPerformance.upsert({
        where: { taskId_year_month: { taskId: row.taskId, year: input.year, month: input.month } },
        create: { taskId: row.taskId, year: input.year, month: input.month, count, amount },
        update: { count, amount },
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
