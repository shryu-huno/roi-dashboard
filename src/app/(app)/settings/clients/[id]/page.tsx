import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { getClient } from "@/lib/data/clients";
import { listTasks } from "@/lib/data/tasks";
import { TaskManager } from "./TaskManager";

export default async function SettingsClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);
  const client = await getClient(ctx, id);
  if (!client) notFound();
  const tasks = await listTasks(ctx, id);

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">{client.name} — 과업·단가</h1>
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
