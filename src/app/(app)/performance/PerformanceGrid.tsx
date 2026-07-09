"use client";

import { useActionState, useState } from "react";
import { savePerformance } from "./actions";
import { OK } from "@/lib/action-state";

type Task = { id: string; name: string; unitPrice: number };

export function PerformanceGrid({
  clientId, year, month, tasks, initialCounts,
}: {
  clientId: string; year: number; month: number;
  tasks: Task[]; initialCounts: Record<string, number>;
}) {
  const [state, formAction] = useActionState(savePerformance, OK);
  const [counts, setCounts] = useState<Record<string, string>>(
    Object.fromEntries(tasks.map((t) => [t.id, initialCounts[t.id]?.toString() ?? ""])),
  );

  const total = tasks.reduce((sum, t) => {
    const n = Number(counts[t.id]);
    return sum + (Number.isFinite(n) ? t.unitPrice * n : 0);
  }, 0);

  return (
    <form action={formAction}>
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="month" value={month} />

      {state.ok && state.message && (
        <p className="mb-3 rounded border border-[var(--color-primary)] px-3 py-2 text-sm text-[var(--color-primary)]">{state.message}</p>
      )}
      {!state.ok && state.error && (
        <p className="mb-3 rounded border border-[var(--color-danger)] px-3 py-2 text-sm text-[var(--color-danger)]">{state.error}</p>
      )}

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
            <th className="py-2">과업</th>
            <th>단가</th>
            <th>횟수</th>
            <th>금액</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => {
            const n = Number(counts[t.id]);
            const amount = Number.isFinite(n) ? t.unitPrice * n : 0;
            return (
              <tr key={t.id} className="border-b border-[var(--color-border)]">
                <td className="py-2">{t.name}</td>
                <td>{t.unitPrice.toLocaleString()}</td>
                <td>
                  <input
                    type="number" min="0" name={`count_${t.id}`} value={counts[t.id]}
                    onChange={(e) => setCounts((c) => ({ ...c, [t.id]: e.target.value }))}
                    className="w-24 rounded border border-[var(--color-border)] px-2 py-1"
                  />
                </td>
                <td>{amount.toLocaleString()}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="font-medium">
            <td className="py-2" colSpan={3}>합계</td>
            <td>{total.toLocaleString()}</td>
          </tr>
        </tfoot>
      </table>

      <button type="submit" className="mt-4 rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white">저장</button>
    </form>
  );
}
