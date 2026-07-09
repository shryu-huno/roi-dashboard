import { requireUser } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { listClients } from "@/lib/data/clients";
import { listTasks } from "@/lib/data/tasks";
import { listPerformance, listPerformanceTotals } from "@/lib/data/performance";
import { PerformanceGrid } from "./PerformanceGrid";

const now = { year: 2026, month: 1 }; // 기본 연월(전역 기간 필터는 Plan 3). 사용자가 선택기로 변경.

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string; year?: string; month?: string }>;
}) {
  const sp = await searchParams;
  const user = await requireUser();
  const ctx = getRlsContext(user);
  const clients = await listClients(ctx);

  const clientId = sp.clientId ?? clients[0]?.id;
  const year = Number(sp.year) || now.year;
  const month = Number(sp.month) || now.month;

  const [tasks, perf, totals] = clientId
    ? await Promise.all([
        listTasks(ctx, clientId),
        listPerformance(ctx, clientId, year, month),
        listPerformanceTotals(ctx, clientId),
      ])
    : [[], [], []];
  const initialCounts = Object.fromEntries(perf.map((p) => [p.taskId, p.count]));
  const totalsByTask = new Map(totals.map((t) => [t.taskId, t]));

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">실적 입력</h1>

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
        <p className="text-[var(--color-muted)]">담당 고객사가 없습니다.</p>
      ) : tasks.length === 0 ? (
        <p className="text-[var(--color-muted)]">등록된 과업이 없습니다. 설정에서 과업을 먼저 등록하세요.</p>
      ) : (
        <>
          <h2 className="mb-2 text-sm font-medium text-[var(--color-muted)]">{year}년 {month}월 실적 (해당 월만 저장)</h2>
          <PerformanceGrid
            clientId={clientId}
            year={year}
            month={month}
            tasks={tasks.map((t) => ({ id: t.id, name: t.name, unitPrice: t.unitPrice }))}
            initialCounts={initialCounts}
          />

          <h2 className="mb-2 mt-10 text-sm font-medium text-[var(--color-muted)]">계약 기간 누적 (전체 월 합계)</h2>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
                <th className="py-2">과업</th>
                <th className="text-right">누적 횟수</th>
                <th className="text-right">계약 횟수</th>
                <th className="text-right">누적 금액</th>
                <th className="text-right">계약금</th>
                <th className="text-right">달성률</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => {
                const tot = totalsByTask.get(t.id);
                const cumCount = tot?.totalCount ?? 0;
                const cumAmount = tot?.totalAmount ?? 0;
                const rate = t.contractCount ? Math.round((cumCount / t.contractCount) * 100) : null;
                return (
                  <tr key={t.id} className="border-b border-[var(--color-border)]">
                    <td className="py-2">{t.name}</td>
                    <td className="text-right">{cumCount.toLocaleString("ko-KR")}</td>
                    <td className="text-right">{t.contractCount == null ? "—" : t.contractCount.toLocaleString("ko-KR")}</td>
                    <td className="text-right">{cumAmount.toLocaleString("ko-KR")}</td>
                    <td className="text-right">{t.contractAmount == null ? "—" : t.contractAmount.toLocaleString("ko-KR")}</td>
                    <td className="text-right">{rate == null ? "—" : `${rate}%`}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-medium">
                <td className="py-2">합계</td>
                <td className="text-right">{tasks.reduce((s, t) => s + (totalsByTask.get(t.id)?.totalCount ?? 0), 0).toLocaleString("ko-KR")}</td>
                <td className="text-right">—</td>
                <td className="text-right">{tasks.reduce((s, t) => s + (totalsByTask.get(t.id)?.totalAmount ?? 0), 0).toLocaleString("ko-KR")}</td>
                <td className="text-right">{tasks.reduce((s, t) => s + (t.contractAmount ?? 0), 0).toLocaleString("ko-KR")}</td>
                <td className="text-right">—</td>
              </tr>
            </tfoot>
          </table>
        </>
      )}
    </div>
  );
}
