import { requireUser } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { isAllAccess, isTeamScoped } from "@/lib/auth/rbac";
import { listClients } from "@/lib/data/clients";
import { effectiveClientStatus } from "@/lib/clients/status";
import { getClientLatestProjectProgress } from "@/lib/data/metrics";
import { attainment } from "@/lib/metrics/formulas";
import { prisma } from "@/lib/db";
import { ClientsList } from "@/components/clients/ClientsList";

export default async function ClientsPage() {
  const user = await requireUser();
  const ctx = getRlsContext(user);
  // 달성률·실적계약 표시는 고객사의 가장 최근 프로젝트 1건 기준. 두 조회는 독립 트랜잭션이라 병렬 실행.
  const [clients, latest] = await Promise.all([
    listClients(ctx),
    getClientLatestProjectProgress(ctx, new Date().getFullYear()),
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
      // 프로젝트가 모두 만료되면 고객사도 계약만료로 표시한다.
      status: effectiveClientStatus(c.status, c.projects),
      industry: c.industry,
      pmLabel: labels.length ? labels.join(", ") : "미배정",
      // 달성률·실적계약은 가장 최근 프로젝트 1건 기준. 최근 프로젝트가 실적 계약이면 달성률 대신 "실적 계약" 표시.
      // (주기는 프로젝트 단위라 활성 프로젝트 전체를 합산해 표시한다.)
      performanceContract: latest.get(c.id)?.performanceContract ?? false,
      progress: (() => {
        const lp = latest.get(c.id);
        return lp ? attainment(lp.perf, lp.contract) : null;
      })(),
      billingCycle: [...new Set(c.projects.flatMap((p) => p.billingCycle))],
      reportCycle: [...new Set(c.projects.flatMap((p) => p.reportCycle))],
      hyundaiEasywel: c.hyundaiEasywel,
    };
  });

  return <ClientsList clients={rows} showPm={showPm} isAdmin={isAdmin} />;
}
