import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { listClients } from "@/lib/data/clients";

export default async function ClientsPage() {
  const user = await requireUser();
  const ctx = getRlsContext(user);
  const clients = await listClients(ctx);

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">고객사 목록</h1>
      {clients.length === 0 ? (
        <p className="text-[var(--color-muted)]">담당 고객사가 없습니다.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((c) => (
            <Link
              key={c.id}
              href={`/clients/${c.id}`}
              className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm hover:border-[var(--color-primary)]"
            >
              <div className="text-base font-medium text-[var(--color-fg)]">{c.name}</div>
              <div className="mt-1 text-xs text-[var(--color-muted)]">{c.status}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
