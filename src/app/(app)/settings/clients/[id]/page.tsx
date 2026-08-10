import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { getClient } from "@/lib/data/clients";
import { listProjects } from "@/lib/data/projects";
import { prisma } from "@/lib/db";
import { EditClientForm } from "./EditClientForm";
import { NewProjectForm } from "./NewProjectForm";
import { ProjectCard } from "./ProjectCard";
import { deriveProjectName } from "@/lib/clients/summary-view";

function toDateInput(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export default async function SettingsClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireRole("PM");
  const isPm = user.role === "PM";
  const ctx = getRlsContext(user);
  const client = await getClient(ctx, id);
  if (!client) notFound();
  const [projects, pms] = await Promise.all([
    listProjects(ctx, id),
    prisma.user.findMany({ where: { role: "PM", status: "ACTIVE" }, orderBy: { name: "asc" } }),
  ]);
  const pmOptions = pms
    .map((p) => ({ id: p.id, label: p.name ?? p.email }))
    .sort((a, b) => a.label.localeCompare(b.label, "ko"));

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">{client.name} — 프로젝트 설정</h1>
      <EditClientForm
        client={{
          id: client.id,
          name: client.name,
          status: client.status,
          businessType: client.businessType,
          industry: client.industry,
        }}
      />

      <h2 className="mb-2 text-base font-semibold">프로젝트</h2>
      {/* 프로젝트 추가·담당 PM 배정은 정산담당자/관리자만. PM은 배정받은 프로젝트의 정보·과업만 수정한다. */}
      {!isPm && <NewProjectForm clientId={client.id} pms={pmOptions} />}

      {projects.length === 0 ? (
        <p className="text-[var(--color-muted)]">등록된 프로젝트가 없습니다.</p>
      ) : (
        projects.map((p) => {
          const start = toDateInput(p.contractStart);
          const end = toDateInput(p.contractEnd);
          // 소제목 라벨: 계약연도(예: "2026", "2025~2026"). 계약기간 없으면 저장된 이름/"미정".
          const label = deriveProjectName(start, end).replaceAll("년", "") || p.name || "미정";
          return (
            <ProjectCard
              key={p.id}
              canManagePms={!isPm}
              pms={pmOptions}
              pmIds={p.managers.map((m) => m.userId)}
              tasks={p.tasks.map((t) => ({
                id: t.id,
                name: t.name,
                unitPrice: t.unitPrice,
                contractCount: t.contractCount,
                contractAmount: t.contractAmount,
              }))}
              project={{
                id: p.id,
                clientId: client.id,
                label,
                status: p.status,
                contractStart: start,
                contractEnd: end,
                billingCycle: p.billingCycle,
                reportCycle: p.reportCycle,
                performanceContract: p.performanceContract,
              }}
            />
          );
        })
      )}
    </div>
  );
}
