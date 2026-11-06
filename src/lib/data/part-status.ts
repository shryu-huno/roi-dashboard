import { withRLS, type RlsContext } from "@/lib/rls";
import { overlapRatio } from "@/lib/metrics/proration";
import type { ClientFacts } from "@/lib/part-status";

export type PartStatusFacts = {
  clientsByPm: Record<string, string[]>; // 공동 담당 고객사는 담당 PM 모두에게 들어간다
  clients: Record<string, ClientFacts>;
};

const zeros = () => Array.from({ length: 12 }, () => 0);

/**
 * 선택한 PM들의 담당 고객사와, 그 고객사의 올해(year) 월별 실적·귀속 계약금을 한 번에 읽는다.
 * 계산 규칙은 전체 현황과 같다: 실적은 과세/면세를 나눠 담고(부가세는 집계 쪽에서 적용),
 * 계약금은 계약기간 월수 비례로 그 해에 귀속되는 금액(관리자 달성률 분모, overlapRatio)을 과세/면세별로 합산한다.
 * 보관(삭제)된 고객사는 제외. 조회 범위는 RLS가 정한다(최고관리자 전체/팀 관리자 팀 범위).
 */
export function loadPartStatusFacts(ctx: RlsContext, p: { pmIds: string[]; year: number }): Promise<PartStatusFacts> {
  return withRLS(ctx, async (tx) => {
    const assignments = await tx.clientManager.findMany({
      where: { userId: { in: p.pmIds }, client: { deletedAt: null } },
      select: { userId: true, clientId: true },
    });
    const clientsByPm: PartStatusFacts["clientsByPm"] = {};
    for (const a of assignments) (clientsByPm[a.userId] ??= []).push(a.clientId);
    const ids = [...new Set(assignments.map((a) => a.clientId))];

    const [clientRows, projects, perfRows] = await Promise.all([
      tx.client.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
      tx.project.findMany({
        where: { deletedAt: null, clientId: { in: ids } },
        select: { clientId: true, contractStart: true, contractEnd: true, tasks: { select: { contractAmount: true, vatExempt: true } } },
      }),
      tx.monthlyPerformance.findMany({
        where: { year: p.year, task: { clientId: { in: ids } } },
        select: { month: true, amount: true, task: { select: { clientId: true, vatExempt: true } } },
      }),
    ]);

    const clients: Record<string, ClientFacts> = {};
    for (const c of clientRows) {
      clients[c.id] = { id: c.id, name: c.name, contractTaxable: 0, contractExempt: 0, perfTaxable: zeros(), perfExempt: zeros() };
    }
    for (const pr of projects) {
      const ratio = overlapRatio(p.year, "all", pr.contractStart, pr.contractEnd);
      if (ratio === 0 || !clients[pr.clientId]) continue;
      for (const t of pr.tasks) {
        const amt = (t.contractAmount ?? 0) * ratio;
        if (t.vatExempt) clients[pr.clientId].contractExempt += amt;
        else clients[pr.clientId].contractTaxable += amt;
      }
    }
    for (const r of perfRows) {
      const c = clients[r.task.clientId];
      if (!c) continue;
      (r.task.vatExempt ? c.perfExempt : c.perfTaxable)[r.month - 1] += r.amount;
    }
    return { clientsByPm, clients };
  });
}
