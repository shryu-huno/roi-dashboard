import { requireUser } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { hasAtLeast } from "@/lib/auth/rbac";
import { listClients } from "@/lib/data/clients";
import { getClientYearProgress } from "@/lib/data/metrics";
import { attainment } from "@/lib/metrics/formulas";
import { prisma } from "@/lib/db";
import { ClientsList } from "@/components/clients/ClientsList";

export default async function ClientsPage() {
  const user = await requireUser();
  const ctx = getRlsContext(user);
  // 진행율은 올해 누적 실적 ÷ 전체 계약금액. 두 조회는 독립 트랜잭션이라 병렬 실행.
  const [clients, { perf, contract }] = await Promise.all([
    listClients(ctx),
    getClientYearProgress(ctx, new Date().getFullYear()),
  ]);
  const showPm = hasAtLeast(user.role, "SETTLEMENT");

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
      status: c.status,
      industry: c.industry,
      pmLabel: labels.length ? labels.join(", ") : "미배정",
      // 계약금액이 0/없음이면 attainment가 null → 카드에서 "실적 계약" 표시.
      progress: attainment(perf.get(c.id) ?? 0, contract.get(c.id) ?? 0),
      billingCycle: c.billingCycle,
      reportCycle: c.reportCycle,
      hyundaiEasywel: c.hyundaiEasywel,
    };
  });

  return <ClientsList clients={rows} showPm={showPm} />;
}
