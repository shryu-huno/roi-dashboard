import { requireUser } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { listClients } from "@/lib/data/clients";
import { listTasks } from "@/lib/data/tasks";
import { listPerformance } from "@/lib/data/performance";
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

  const [tasks, perf] = clientId
    ? await Promise.all([listTasks(ctx, clientId), listPerformance(ctx, clientId, year, month)])
    : [[], []];
  const initialCounts = Object.fromEntries(perf.map((p) => [p.taskId, p.count]));

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">실적 입력</h1>

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
        <p className="text-[var(--color-muted)]">담당 고객사가 없습니다.</p>
      ) : tasks.length === 0 ? (
        <p className="text-[var(--color-muted)]">등록된 과업이 없습니다. 설정에서 과업을 먼저 등록하세요.</p>
      ) : (
        <PerformanceGrid
          clientId={clientId}
          year={year}
          month={month}
          tasks={tasks.map((t) => ({ id: t.id, name: t.name, unitPrice: t.unitPrice }))}
          initialCounts={initialCounts}
        />
      )}
    </div>
  );
}
