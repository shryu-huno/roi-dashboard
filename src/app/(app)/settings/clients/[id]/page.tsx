import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { getClient } from "@/lib/data/clients";
import { listTasks } from "@/lib/data/tasks";
import { prisma } from "@/lib/db";
import { TaskManager } from "./TaskManager";
import { EditClientForm } from "./EditClientForm";

function toDateInput(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export default async function SettingsClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);
  const client = await getClient(ctx, id);
  if (!client) notFound();
  const [tasks, pms] = await Promise.all([
    listTasks(ctx, id),
    prisma.user.findMany({ where: { role: "PM", status: "ACTIVE" }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">{client.name} — 고객사 정보·과업</h1>
      <EditClientForm
        client={{
          id: client.id,
          name: client.name,
          status: client.status,
          pmId: client.pmId,
          industry: client.industry,
          contractStart: toDateInput(client.contractStart),
          contractEnd: toDateInput(client.contractEnd),
        }}
        pms={pms.map((p) => ({ id: p.id, label: p.name ?? p.email }))}
      />
      <TaskManager
        clientId={id}
        tasks={tasks.map((t) => ({
          id: t.id,
          name: t.name,
          unitPrice: t.unitPrice,
          contractCount: t.contractCount,
          contractAmount: t.contractAmount,
        }))}
      />
    </div>
  );
}
