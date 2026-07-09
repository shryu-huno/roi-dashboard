"use client";

import { useActionState, useState } from "react";
import { saveExpense } from "./actions";
import { OK } from "@/lib/action-state";
import { expenseCategoryLabel } from "@/lib/labels";
import { EXPENSE_CATEGORIES } from "@/lib/validation/schemas";
import { formatThousands } from "@/lib/format";

type Row = { category: (typeof EXPENSE_CATEGORIES)[number]; amount: number | ""; memo: string };

function ExpenseRow({
  clientId, year, month, row,
}: {
  clientId: string; year: number; month: number; row: Row;
}) {
  const [state, formAction] = useActionState(saveExpense, OK);
  const [amount, setAmount] = useState(formatThousands(row.amount));

  return (
    <tr className="border-b border-[var(--color-border)]">
      <td className="py-2">{expenseCategoryLabel(row.category)}</td>
      <td colSpan={3}>
        <form action={formAction} className="flex items-center gap-2">
          <input type="hidden" name="clientId" value={clientId} />
          <input type="hidden" name="year" value={year} />
          <input type="hidden" name="month" value={month} />
          <input type="hidden" name="category" value={row.category} />
          <input
            inputMode="numeric" name="amount" value={amount}
            onChange={(e) => setAmount(formatThousands(e.target.value))}
            className="w-32 rounded border border-[var(--color-border)] px-2 py-1 text-right"
          />
          <input name="memo" defaultValue={row.memo} placeholder="메모" className="flex-1 rounded border border-[var(--color-border)] px-2 py-1" />
          <button type="submit" className="rounded bg-[var(--color-primary)] px-3 py-1 text-white">저장</button>
          {state.ok && state.message && <span className="text-sm text-[var(--color-primary)]">{state.message}</span>}
          {!state.ok && state.error && <span className="text-sm text-[var(--color-danger)]">{state.error}</span>}
        </form>
      </td>
    </tr>
  );
}

export function ExpenseForm({
  clientId, year, month, rows,
}: {
  clientId: string; year: number; month: number; rows: Row[];
}) {
  return (
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
          <ExpenseRow key={r.category} clientId={clientId} year={year} month={month} row={r} />
        ))}
      </tbody>
    </table>
  );
}
