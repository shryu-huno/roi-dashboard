"use client";

import { useActionState, useState } from "react";
import { saveBilling, saveDeposit } from "./actions";
import { OK } from "@/lib/action-state";
import { formatThousands } from "@/lib/format";

function AmountForm({
  label, clientId, year, month, defaultValue, action,
}: {
  label: string; clientId: string; year: number; month: number;
  defaultValue: number | ""; action: typeof saveBilling;
}) {
  const [state, formAction] = useActionState(action, OK);
  const [amount, setAmount] = useState(formatThousands(defaultValue));
  return (
    <form action={formAction} className="mb-3 flex items-end gap-2">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="month" value={month} />
      <label className="flex flex-col text-xs text-[var(--color-muted)]">
        {label}(비우면 미입력)
        <input
          inputMode="numeric" name="amount" value={amount}
          onChange={(e) => setAmount(formatThousands(e.target.value))}
          className="w-40 rounded border border-[var(--color-border)] px-2 py-1 text-right text-sm"
        />
      </label>
      <button type="submit" className="rounded bg-[var(--color-primary)] px-3 py-1.5 text-sm text-white">저장</button>
      {state.ok && state.message && <span className="text-sm text-[var(--color-primary)]">{state.message}</span>}
      {!state.ok && state.error && <span className="text-sm text-[var(--color-danger)]">{state.error}</span>}
    </form>
  );
}

export function BillingForm({
  clientId, year, month, billing, deposit,
}: {
  clientId: string; year: number; month: number;
  billing: number | ""; deposit: number | "";
}) {
  return (
    <div>
      <AmountForm label="청구액" clientId={clientId} year={year} month={month} defaultValue={billing} action={saveBilling} />
      <AmountForm label="입금액" clientId={clientId} year={year} month={month} defaultValue={deposit} action={saveDeposit} />
    </div>
  );
}
