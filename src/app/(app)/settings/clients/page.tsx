import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { listClients } from "@/lib/data/clients";
import { prisma } from "@/lib/db";
import { NewClientForm } from "./NewClientForm";

export default async function SettingsClientsPage() {
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);
  const [clients, pms] = await Promise.all([
    listClients(ctx),
    prisma.user.findMany({ where: { role: "PM", status: "ACTIVE" }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">고객사·과업 설정</h1>

      <NewClientForm pms={pms.map((p) => ({ id: p.id, label: p.name ?? p.email }))} />

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
