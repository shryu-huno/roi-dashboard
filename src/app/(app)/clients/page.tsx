import { requireUser } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { isAllAccess, isTeamScoped } from "@/lib/auth/rbac";
import { listClients } from "@/lib/data/clients";
import { getClientMemoSummaries } from "@/lib/data/clientMemos";
import { effectiveClientStatus } from "@/lib/clients/status";
import { latestProjectSpan } from "@/lib/clients/project-span";
import { getClientLatestProjectProgress } from "@/lib/data/metrics";
import { attainment } from "@/lib/metrics/formulas";
import { prisma } from "@/lib/db";
import { ClientsList } from "@/components/clients/ClientsList";

export default async function ClientsPage() {
  const user = await requireUser();
  const ctx = getRlsContext(user);
  // 달성률·실적계약 표시는 고객사의 가장 최근 프로젝트 1건 기준. 두 조회는 독립 트랜잭션이라 병렬 실행.
  const [clients, latest, memoSummaries] = await Promise.all([
    listClients(ctx),
    getClientLatestProjectProgress(ctx, new Date().getFullYear()),
    getClientMemoSummaries(ctx),
  ]);
  const showPm = isAllAccess(user.role) || isTeamScoped(user.role);
  const isAdmin = isAllAccess(user.role);

  const pmIds = [...new Set(clients.flatMap((c) => c.managers.map((m) => m.userId)))];
  const users = pmIds.length
    ? await prisma.user.findMany({ where: { id: { in: pmIds } } })
    : [];
  const labelById = new Map(users.map((u) => [u.id, u.name ?? u.email]));

  const rows = clients.map((c) => {
    const labels = c.managers
      .map((m) => labelById.get(m.userId) ?? "(알 수 없음)")
      .sort((a, b) => a.localeCompare(b, "ko"));
    return {
      id: c.id,
      name: c.name,
      // 가장 최근 프로젝트 계약기간의 연도 스팬(해 넘김 m / 같은 해 s / 판단 불가 null).
      span: latestProjectSpan(c.projects),
      // 프로젝트가 모두 만료되면 고객사도 계약만료로 표시한다.
      status: effectiveClientStatus(c.status, c.projects),
      industry: c.industry,
      pmLabel: labels.length ? labels.join(", ") : "미배정",
      // 달성률·실적계약은 가장 최근 프로젝트 1건 기준. 최근 프로젝트가 실적 계약이면 달성률 대신 "실적 계약" 표시.
      // (주기는 프로젝트 단위라 활성 프로젝트 전체를 합산해 표시한다.)
      performanceContract: latest.get(c.id)?.performanceContract ?? false,
      progress: (() => {
        const lp = latest.get(c.id);
        if (!lp) return null;
        // 실적 계약은 분모를 계약금 대신 전년도 기준 실적(baseline)으로. baseline 0이면 attainment가 null.
        const denom = lp.performanceContract ? lp.baseline : lp.contract;
        return attainment(lp.perf, denom);
      })(),
      billingCycle: [...new Set(c.projects.flatMap((p) => p.billingCycle))],
      reportCycle: [...new Set(c.projects.flatMap((p) => p.reportCycle))],
      hyundaiEasywel: c.hyundaiEasywel,
      memoCount: memoSummaries.get(c.id)?.count ?? 0,
      latestMemo: memoSummaries.get(c.id)?.latest ?? null,
    };
  });

  return <ClientsList clients={rows} showPm={showPm} isAdmin={isAdmin} />;
}
