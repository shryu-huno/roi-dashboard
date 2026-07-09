import { requireUser } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { listClients } from "@/lib/data/clients";
import { getBilling, getDeposit } from "@/lib/data/billing";
import { BillingForm } from "./BillingForm";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string; year?: string; month?: string }>;
}) {
  const sp = await searchParams;
  const user = await requireUser();
  const ctx = getRlsContext(user);
  const clients = await listClients(ctx);

  const clientId = sp.clientId ?? clients[0]?.id;
  const year = Number(sp.year) || 2026;
  const month = Number(sp.month) || 1;

  const [billing, deposit] = clientId
    ? await Promise.all([getBilling(ctx, clientId, year, month), getDeposit(ctx, clientId, year, month)])
    : [null, null];

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">청구·입금 입력</h1>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          고객사
          <select name="clientId" defaultValue={clientId ?? ""} className="mt-1 w-48 rounded border border-[var(--color-border)] px-3 py-2 text-sm">
            {clients.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          연도
          <input type="number" name="year" defaultValue={year} className="mt-1 w-28 rounded border border-[var(--color-border)] px-3 py-2 text-sm" />
        </label>
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          월
          <input type="number" name="month" min="1" max="12" defaultValue={month} className="mt-1 w-24 rounded border border-[var(--color-border)] px-3 py-2 text-sm" />
        </label>
        <button type="submit" className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white">조회</button>
      </form>

      {!clientId ? (
        <p className="text-[var(--color-muted)]">고객사가 없습니다.</p>
      ) : (
        <BillingForm
          clientId={clientId}
          year={year}
          month={month}
          billing={(billing?.amount ?? "") as number | ""}
          deposit={(deposit?.amount ?? "") as number | ""}
        />
      )}
    </div>
  );
}
