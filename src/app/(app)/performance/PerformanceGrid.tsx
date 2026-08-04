"use client";

import { useActionState, useState } from "react";
import { savePerformance } from "./actions";
import { OK } from "@/lib/action-state";

type Task = { id: string; name: string; unitPrice: number };

export function PerformanceGrid({
  clientId, year, month, tasks, initialCounts, initialAmounts,
}: {
  clientId: string; year: number; month: number;
  tasks: Task[]; initialCounts: Record<string, number>; initialAmounts: Record<string, number>;
}) {
  const [state, formAction] = useActionState(savePerformance, OK);
  const [counts, setCounts] = useState<Record<string, string>>(
    Object.fromEntries(tasks.map((t) => [t.id, initialCounts[t.id]?.toString() ?? ""])),
  );
  const [amounts, setAmounts] = useState<Record<string, string>>(
    Object.fromEntries(tasks.map((t) => [t.id, initialAmounts[t.id]?.toLocaleString() ?? ""])),
  );

  // 행별 유효 금액: 금액 직접입력이면 그 값, 아니면 단가×횟수 파생.
  const total = tasks.reduce((sum, t) => {
    const amountFilled = (amounts[t.id] ?? "").trim() !== "";
    if (amountFilled) {
      const m = Number(amounts[t.id].replace(/,/g, ""));
      return sum + (Number.isFinite(m) ? m : 0);
    }
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

      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[18px] font-medium text-black">{year}년 {month}월 실적</h2>
        <button type="submit" className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white">저장</button>
      </div>

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
            const countFilled = (counts[t.id] ?? "").trim() !== "";
            const amountFilled = (amounts[t.id] ?? "").trim() !== "";
            const n = Number(counts[t.id]);
            const derived = countFilled && Number.isFinite(n) ? t.unitPrice * n : 0;
            return (
              <tr key={t.id} className="border-b border-[var(--color-border)] transition-colors hover:bg-white">
                <td className="py-2">{t.name}</td>
                <td>{t.unitPrice.toLocaleString()}</td>
                <td>
                  <input
                    type="number" min="0" name={`count_${t.id}`} value={counts[t.id]}
                    disabled={amountFilled}
                    onChange={(e) => setCounts((c) => ({ ...c, [t.id]: e.target.value }))}
                    className="w-24 rounded border border-[var(--color-border)] px-2 py-1 disabled:bg-[var(--color-border)] disabled:text-[var(--color-muted)]"
                  />
                </td>
                <td>
                  <input
                    type="text" inputMode="numeric" name={`amount_${t.id}`}
                    value={countFilled ? derived.toLocaleString() : amounts[t.id]}
                    disabled={countFilled}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/[^\d]/g, "");
                      setAmounts((a) => ({ ...a, [t.id]: digits === "" ? "" : Number(digits).toLocaleString() }));
                    }}
                    className="w-32 rounded border border-[var(--color-border)] px-2 py-1 disabled:bg-[var(--color-border)] disabled:text-[var(--color-muted)]"
                  />
                </td>
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
    </form>
  );
}
