import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { getClient } from "@/lib/data/clients";
import { expenseSummaryLabel, parseExpenseSummaryKey } from "@/lib/expense-summary";
import { orderRange, parseYm, rangeLabel, ymValue } from "@/lib/month-range";
import { canAccessExpenseTab } from "../tabs";

// 전체 내역 → 분류별 상세보기 대상 페이지.
// 현재는 항목별 지출 라인아이템 데이터 모델이 없어 빈 상태 셸로 표시한다.
export default async function ExpenseDetailPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string; from?: string; to?: string; category?: string }>;
}) {
  const sp = await searchParams;
  const user = await requireUser();
  const role = user.role;
  // 전체 내역 탭과 동일한 접근 통제(관리자·정산담당자 전체, PM은 담당 고객사 범위).
  if (!role || !canAccessExpenseTab(role, "all")) redirect("/expenses");

  const category = parseExpenseSummaryKey(sp.category);
  const clientId = sp.clientId;
  const parsedFrom = parseYm(sp.from);
  if (!category || !clientId || !parsedFrom) redirect("/expenses?tab=all");
  const [from, to] = orderRange(parsedFrom, parseYm(sp.to) ?? parsedFrom);

  const ctx = getRlsContext(user);
  const client = await getClient(ctx, clientId); // RLS 스코프 — PM 담당 밖이면 null
  if (!client) notFound();

  const backHref = `/expenses?tab=all&clientId=${clientId}&from=${ymValue(from)}&to=${ymValue(to)}`;

  return (
    <div>
      <Link href={backHref} className="text-sm text-[var(--color-muted)] hover:underline">
        ← 전체 내역
      </Link>
      <h1 className="mb-1 mt-3 text-xl font-semibold">{expenseSummaryLabel(category)} 상세 내역</h1>
      <p className="mb-6 text-sm text-[var(--color-muted)]">
        {client.name} · {rangeLabel(from, to)}
      </p>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
            <th className="py-2">지출 항목</th>
            <th className="text-right">금액</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={2} className="py-10 text-center text-[var(--color-muted)]">
              해당 분류의 상세 지출 내역이 아직 없습니다.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
