import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { listClients } from "@/lib/data/clients";
import { prisma } from "@/lib/db";
import { createClientAction } from "./actions";

export default async function SettingsClientsPage() {
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);
  const [clients, pms] = await Promise.all([
    listClients(ctx),
    prisma.user.findMany({ where: { role: "PM", status: "ACTIVE" }, orderBy: { email: "asc" } }),
  ]);

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">고객사·과업 설정</h1>

      <form action={createClientAction} className="mb-6 flex flex-wrap items-end gap-2 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          고객사명
          <input name="name" required className="rounded border border-[var(--color-border)] px-2 py-1 text-sm" />
        </label>
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          담당 PM
          <select name="pmId" defaultValue="" className="rounded border border-[var(--color-border)] px-2 py-1 text-sm">
            <option value="">미지정</option>
            {pms.map((p) => (
              <option key={p.id} value={p.id}>{p.email}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          계약 시작
          <input type="date" name="contractStart" className="rounded border border-[var(--color-border)] px-2 py-1 text-sm" />
        </label>
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          계약 종료
          <input type="date" name="contractEnd" className="rounded border border-[var(--color-border)] px-2 py-1 text-sm" />
        </label>
        <button type="submit" className="rounded bg-[var(--color-primary)] px-3 py-1.5 text-sm text-white">고객사 추가</button>
      </form>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
            <th className="py-2">고객사</th>
            <th>상태</th>
            <th>작업</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((c) => (
            <tr key={c.id} className="border-b border-[var(--color-border)]">
              <td className="py-2">{c.name}</td>
              <td>{c.status}</td>
              <td>
                <Link href={`/settings/clients/${c.id}`} className="text-[var(--color-primary)]">과업·단가 설정</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
