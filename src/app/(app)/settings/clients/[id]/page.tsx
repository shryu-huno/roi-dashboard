import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { getClient } from "@/lib/data/clients";
import { listTasks } from "@/lib/data/tasks";
import { createTaskAction, updateTaskAction, deleteTaskAction } from "../actions";

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

      <form action={createTaskAction} className="mb-6 flex flex-wrap items-end gap-2 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <input type="hidden" name="clientId" value={id} />
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          과업명
          <input name="name" required className="rounded border border-[var(--color-border)] px-2 py-1 text-sm" />
        </label>
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          단가(원)
          <input type="number" name="unitPrice" min="0" required className="rounded border border-[var(--color-border)] px-2 py-1 text-sm" />
        </label>
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          계약금(원, 없으면 비움)
          <input type="number" name="contractAmount" min="0" className="rounded border border-[var(--color-border)] px-2 py-1 text-sm" />
        </label>
        <button type="submit" className="rounded bg-[var(--color-primary)] px-3 py-1.5 text-sm text-white">과업 추가</button>
      </form>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
            <th className="py-2">과업</th>
            <th>단가</th>
            <th>계약금</th>
            <th>작업</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} className="border-b border-[var(--color-border)]">
              <td className="py-2">
                <form action={updateTaskAction} className="flex items-center gap-1">
                  <input type="hidden" name="id" value={t.id} />
                  <input type="hidden" name="clientId" value={id} />
                  <input name="name" defaultValue={t.name} className="rounded border border-[var(--color-border)] px-2 py-1" />
                  <input type="number" name="unitPrice" min="0" defaultValue={t.unitPrice} className="w-24 rounded border border-[var(--color-border)] px-2 py-1" />
                  <input type="number" name="contractAmount" min="0" defaultValue={t.contractAmount ?? ""} className="w-28 rounded border border-[var(--color-border)] px-2 py-1" />
                  <button type="submit" className="rounded bg-[var(--color-primary)] px-2 py-1 text-white">저장</button>
                </form>
              </td>
              <td>{t.unitPrice.toLocaleString()}</td>
              <td>{t.contractAmount == null ? "—" : t.contractAmount.toLocaleString()}</td>
              <td>
                <form action={deleteTaskAction}>
                  <input type="hidden" name="id" value={t.id} />
                  <input type="hidden" name="clientId" value={id} />
                  <button type="submit" className="rounded border border-[var(--color-border)] px-2 py-1">삭제</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
