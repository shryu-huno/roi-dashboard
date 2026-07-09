import { requireUser } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { listClients } from "@/lib/data/clients";
import { listExpenses } from "@/lib/data/expenses";
import { EXPENSE_CATEGORIES } from "@/lib/validation/schemas";
import { ExpenseForm } from "./ExpenseForm";

export default async function ExpensesPage({
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

  const existing = clientId ? await listExpenses(ctx, clientId, year, month) : [];
  const byCat = new Map(existing.map((e) => [e.category, e]));
  const rows = EXPENSE_CATEGORIES.map((category) => ({
    category,
    amount: (byCat.get(category)?.amount ?? "") as number | "",
    memo: byCat.get(category)?.memo ?? "",
  }));

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">지출 입력</h1>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          고객사
          <select name="clientId" defaultValue={clientId ?? ""} className="rounded border border-[var(--color-border)] px-2 py-1 text-sm">
            {clients.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          연도
          <input type="number" name="year" defaultValue={year} className="w-24 rounded border border-[var(--color-border)] px-2 py-1 text-sm" />
        </label>
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          월
          <input type="number" name="month" min="1" max="12" defaultValue={month} className="w-20 rounded border border-[var(--color-border)] px-2 py-1 text-sm" />
        </label>
        <button type="submit" className="rounded border border-[var(--color-border)] px-3 py-1.5 text-sm">조회</button>
      </form>

      {!clientId ? (
        <p className="text-[var(--color-muted)]">고객사가 없습니다.</p>
      ) : (
        <ExpenseForm clientId={clientId} year={year} month={month} rows={rows} />
      )}
    </div>
  );
}
