"use client";

import { useActionState } from "react";
import { saveExpense } from "./actions";
import { OK } from "@/lib/action-state";
import { expenseCategoryLabel } from "@/lib/labels";
import { EXPENSE_CATEGORIES } from "@/lib/validation/schemas";

type Row = { category: (typeof EXPENSE_CATEGORIES)[number]; amount: number | ""; memo: string };

export function ExpenseForm({
  clientId, year, month, rows,
}: {
  clientId: string; year: number; month: number; rows: Row[];
}) {
  const [state, formAction] = useActionState(saveExpense, OK);
  return (
    <div>
      {!state.ok && state.error && (
        <p className="mb-3 rounded border border-[var(--color-danger)] px-3 py-2 text-sm text-[var(--color-danger)]">{state.error}</p>
      )}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
            <th className="py-2">분류</th>
            <th>금액</th>
            <th>메모</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.category} className="border-b border-[var(--color-border)]">
              <td className="py-2">{expenseCategoryLabel(r.category)}</td>
              <td colSpan={3}>
                <form action={formAction} className="flex items-center gap-2">
                  <input type="hidden" name="clientId" value={clientId} />
                  <input type="hidden" name="year" value={year} />
                  <input type="hidden" name="month" value={month} />
                  <input type="hidden" name="category" value={r.category} />
                  <input type="number" min="0" name="amount" defaultValue={r.amount} className="w-32 rounded border border-[var(--color-border)] px-2 py-1" />
                  <input name="memo" defaultValue={r.memo} placeholder="메모" className="flex-1 rounded border border-[var(--color-border)] px-2 py-1" />
                  <button type="submit" className="rounded bg-[var(--color-primary)] px-3 py-1 text-white">저장</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
