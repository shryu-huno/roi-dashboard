import { Prisma } from "@prisma/client";
import { withRLS, type RlsContext } from "@/lib/rls";
import type { ActionState } from "@/lib/action-state";
import { eachMonth, orderRange, type Ym } from "@/lib/month-range";

// 횟수 모드(count!=null)로 입력한 실적 금액은 단가×횟수 파생값이라, 입력 시점 단가로 스냅샷된다.
// 과업 단가가 바뀌면 과거 실적 금액이 옛 단가로 남으므로, 단가 변경 시 이 함수로 새 단가로 다시 계산한다.
// 금액 직접입력 모드(count==null)는 사용자가 넣은 확정 금액이므로 건드리지 않는다.
export function recomputePerformanceAmounts(tx: Prisma.TransactionClient, taskId: string, unitPrice: number) {
  return tx.$executeRaw`UPDATE "MonthlyPerformance" SET "amount" = ROUND("count" * ${unitPrice})::int, "updatedAt" = now() WHERE "taskId" = ${taskId} AND "count" IS NOT NULL`;
}

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

export type PerformanceTotal = { taskId: string; totalCount: number; totalAmount: number };

// 누적 집계 기준.
//  - year:    조회 연도(1~12월) 1년치 실적을 합산한다(기본, "최신연도 기준").
//  - project: 조회 월(year·month)을 계약기간에 포함하는 프로젝트별로, 그 프로젝트의 계약기간
//             전체(연 경계 무시)를 합산한다. 계약 시작/종료일이 비어있으면 조회 연도로 폴백한다.
export type TotalsBasis =
  | { basis: "year"; year: number }
  | { basis: "project"; year: number; month: number };

function toYm(d: Date): Ym {
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export async function listPerformanceTotals(
  ctx: RlsContext,
  clientId: string,
  opts: TotalsBasis,
): Promise<PerformanceTotal[]> {
  return withRLS(ctx, async (tx) => {
    if (opts.basis === "year") {
      const grouped = await tx.monthlyPerformance.groupBy({
        by: ["taskId"],
        where: { task: { clientId }, year: opts.year },
        _sum: { count: true, amount: true },
      });
      return grouped.map((g) => ({ taskId: g.taskId, totalCount: g._sum.count ?? 0, totalAmount: g._sum.amount ?? 0 }));
    }
    // 프로젝트 기준: 조회 월을 계약기간에 포함하는 프로젝트만 골라, 각 프로젝트의 계약기간 전체를 합산.
    const monthStart = new Date(Date.UTC(opts.year, opts.month - 1, 1));
    const monthEnd = new Date(Date.UTC(opts.year, opts.month, 0, 23, 59, 59, 999));
    const projects = await tx.project.findMany({
      where: {
        clientId,
        deletedAt: null,
        AND: [
          { OR: [{ contractStart: null }, { contractStart: { lte: monthEnd } }] },
          { OR: [{ contractEnd: null }, { contractEnd: { gte: monthStart } }] },
        ],
      },
      select: { contractStart: true, contractEnd: true, tasks: { select: { id: true } } },
    });
    const totals: PerformanceTotal[] = [];
    for (const p of projects) {
      const taskIds = p.tasks.map((t) => t.id);
      if (!taskIds.length) continue;
      // 계약기간이 있으면 그 월범위, 없으면 조회 연도(1~12월)로 폴백(프로젝트 브레이크다운과 동일 규칙).
      const months =
        p.contractStart && p.contractEnd
          ? eachMonth(...orderRange(toYm(p.contractStart), toYm(p.contractEnd)))
          : eachMonth({ year: opts.year, month: 1 }, { year: opts.year, month: 12 });
      const grouped = await tx.monthlyPerformance.groupBy({
        by: ["taskId"],
        where: { taskId: { in: taskIds }, OR: months.map((m) => ({ year: m.year, month: m.month })) },
        _sum: { count: true, amount: true },
      });
      for (const g of grouped) {
        totals.push({ taskId: g.taskId, totalCount: g._sum.count ?? 0, totalAmount: g._sum.amount ?? 0 });
      }
    }
    return totals;
  });
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
      // 횟수 모드 파생 금액은 원 단위 정수로 반올림한다(소수 횟수 × 단가 → 소수 원 방지).
      const amount = row.amount != null ? row.amount : Math.round(task.unitPrice * (row.count as number));
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
