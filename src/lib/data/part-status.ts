import { withRLS, type RlsContext } from "@/lib/rls";
import { overlapRatio } from "@/lib/metrics/proration";
import type { ClientFacts } from "@/lib/part-status";

export type PartStatusFacts = {
  clientsByPm: Record<string, string[]>; // 공동 담당 고객사는 담당 PM 모두에게 들어간다
  clients: Record<string, ClientFacts>;
  unassignedClientIds: string[]; // includeUnassigned일 때만: 담당자 목록(pmIds)에 아무도 없는 고객사
};

const zeros = () => Array.from({ length: 12 }, () => 0);

/**
 * 선택한 PM들의 담당 고객사와, 그 고객사의 올해(year) 월별 실적·귀속 계약금을 한 번에 읽는다.
 * 계산 규칙은 전체 현황과 같다: 실적은 과세/면세를 나눠 담고(부가세는 집계 쪽에서 적용),
 * 계약금은 계약기간 월수 비례로 그 해에 귀속되는 금액(관리자 달성률 분모, overlapRatio)을 과세/면세별로 합산한다.
 * 보관(삭제)된 고객사는 제외. 조회 범위는 RLS가 정한다(최고관리자 전체/팀 관리자 팀 범위).
 * 계약 전체 금액(fullTaxable/fullExempt)은 올해와 겹치는 계약의 기간 전체 금액으로, 연 단위로 나누지 않는다.
 * includeUnassigned: 담당자 목록 밖의 고객사(담당 PM 없음·비활성 담당자뿐 등)도 함께 읽어 unassignedClientIds로 알려 준다.
 * 그러면 "전체"가 전체 현황(보관 제외 전 고객사)과 같아진다.
 */
export function loadPartStatusFacts(
  ctx: RlsContext,
  p: { pmIds: string[]; year: number; includeUnassigned?: boolean },
): Promise<PartStatusFacts> {
  return withRLS(ctx, async (tx) => {
    const assignments = await tx.clientManager.findMany({
      where: { userId: { in: p.pmIds }, client: { deletedAt: null } },
      select: { userId: true, clientId: true },
    });
    const clientsByPm: PartStatusFacts["clientsByPm"] = {};
    for (const a of assignments) (clientsByPm[a.userId] ??= []).push(a.clientId);
    const assigned = [...new Set(assignments.map((a) => a.clientId))];
    let unassignedClientIds: string[] = [];
    if (p.includeUnassigned) {
      const all = await tx.client.findMany({ where: { deletedAt: null }, select: { id: true } });
      const have = new Set(assigned);
      unassignedClientIds = all.map((c) => c.id).filter((id) => !have.has(id));
    }
    const ids = [...assigned, ...unassignedClientIds];

    const [clientRows, projects, perfRows] = await Promise.all([
      tx.client.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
      tx.project.findMany({
        where: { deletedAt: null, clientId: { in: ids } },
        // 고객사별 첫 행 = 가장 최근 프로젝트(고객사 목록·전체 현황과 같은 기준). 실적 계약 표시에 쓴다.
        orderBy: [{ contractStart: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
        select: { clientId: true, performanceContract: true, contractStart: true, contractEnd: true, tasks: { select: { contractAmount: true, vatExempt: true } } },
      }),
      tx.monthlyPerformance.findMany({
        where: { year: p.year, task: { clientId: { in: ids } } },
        select: { month: true, amount: true, task: { select: { clientId: true, vatExempt: true } } },
      }),
    ]);

    const clients: Record<string, ClientFacts> = {};
    for (const c of clientRows) {
      clients[c.id] = { id: c.id, name: c.name, contractTaxable: 0, contractExempt: 0, fullTaxable: 0, fullExempt: 0, performanceContract: false, perfTaxable: zeros(), perfExempt: zeros() };
    }
    const flagged = new Set<string>();
    for (const pr of projects) {
      if (!flagged.has(pr.clientId) && clients[pr.clientId]) {
        flagged.add(pr.clientId);
        clients[pr.clientId].performanceContract = pr.performanceContract;
      }
      const ratio = overlapRatio(p.year, "all", pr.contractStart, pr.contractEnd);
      if (ratio === 0 || !clients[pr.clientId]) continue;
      const c = clients[pr.clientId];
      for (const t of pr.tasks) {
        const full = t.contractAmount ?? 0;
        if (t.vatExempt) {
          c.contractExempt += full * ratio;
          c.fullExempt += full;
        } else {
          c.contractTaxable += full * ratio;
          c.fullTaxable += full;
        }
      }
    }
    for (const r of perfRows) {
      const c = clients[r.task.clientId];
      if (!c) continue;
      (r.task.vatExempt ? c.perfExempt : c.perfTaxable)[r.month - 1] += r.amount;
    }
    return { clientsByPm, clients, unassignedClientIds };
  });
}
