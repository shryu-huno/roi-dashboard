import { requireUser } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { listClients } from "@/lib/data/clients";
import { listTasks } from "@/lib/data/tasks";
import { listPerformance, listPerformanceTotals } from "@/lib/data/performance";
import { PerformanceGrid } from "./PerformanceGrid";
import { ClientCombobox } from "@/components/ClientCombobox";

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string; year?: string; month?: string }>;
}) {
  const sp = await searchParams;
  const user = await requireUser();
  const ctx = getRlsContext(user);
  const clients = await listClients(ctx);

  // 기본 연월: 사용자가 선택하지 않았을 때 '접속 시점의 한국 시간(Asia/Seoul)' 연·월을 쓴다.
  // 서버(Node)는 UTC로 동작할 수 있어 en-CA 포맷("YYYY-MM-DD")으로 한국 날짜를 얻어 분해한다.
  const kstToday = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const [defaultYear, defaultMonth] = kstToday.split("-").map(Number);

  // 조회 전(콤보박스가 비어 clientId가 "" 또는 없음)에는 기본 고객사로 폴백하지 않는다.
  // 사용자가 고객사를 검색·조회해야만 해당 고객사 실적이 나오도록 빈 값으로 둔다.
  const clientId = sp.clientId || undefined;
  const year = Number(sp.year) || defaultYear;
  const month = Number(sp.month) || defaultMonth;

  const [tasks, perf, totals] = clientId
    ? await Promise.all([
        listTasks(ctx, clientId),
        listPerformance(ctx, clientId, year, month),
        listPerformanceTotals(ctx, clientId),
      ])
    : [[], [], []];
  // count가 null인 레코드는 금액 직접입력 모드 → 금액을 초깃값으로 복원.
  const initialCounts = Object.fromEntries(perf.filter((p) => p.count != null).map((p) => [p.taskId, p.count!]));
  const initialAmounts = Object.fromEntries(perf.filter((p) => p.count == null).map((p) => [p.taskId, p.amount]));
  const totalsByTask = new Map(totals.map((t) => [t.taskId, t]));

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">실적 입력</h1>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          고객사
          <ClientCombobox clients={clients.map((c) => ({ id: c.id, name: c.name }))} defaultClientId={sp.clientId} className="w-48" />
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
        <p className="text-[var(--color-muted)]">고객사를 조회하세요.</p>
      ) : tasks.length === 0 ? (
        <p className="text-[var(--color-muted)]">등록된 과업이 없습니다. 설정에서 과업을 먼저 등록하세요.</p>
      ) : (
        <>
          <PerformanceGrid
            clientId={clientId}
            year={year}
            month={month}
            tasks={tasks.map((t) => ({ id: t.id, name: t.name, unitPrice: t.unitPrice }))}
            initialCounts={initialCounts}
            initialAmounts={initialAmounts}
          />

          <h2 className="mb-2 mt-10 text-[18px] font-medium text-black">{year}년 누적</h2>
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
                // 계약금 기준 우선(금액 모드 과업 대응). 횟수 과업은 계약금=단가×계약횟수라 결과 동일.
                const rate = t.contractAmount
                  ? Math.round((cumAmount / t.contractAmount) * 100)
                  : (t.contractCount ? Math.round((cumCount / t.contractCount) * 100) : null);
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
