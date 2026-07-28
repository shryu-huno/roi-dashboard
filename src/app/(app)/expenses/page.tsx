import { redirect } from "next/navigation";
import { requireUser, type SessionUser } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { listClients } from "@/lib/data/clients";
import { getExpenseSummaryTotals } from "@/lib/data/expenses";
import { listPayees, parsePayeeSearchField } from "@/lib/data/payees";
import { EXPENSE_SUMMARY_CATEGORIES } from "@/lib/expense-summary";
import { orderRange, parseYm, ymValue } from "@/lib/month-range";
import { ClientCombobox } from "./ClientCombobox";
import { ExpenseSummaryTable } from "./ExpenseSummaryTable";
import { ExpenseTabs } from "./ExpenseTabs";
import { PayeeListPanel } from "./PayeeListPanel";
import {
  DEFAULT_EXPENSE_TAB,
  canAccessExpenseTab,
  visibleExpenseTabs,
  type ExpenseTabKey,
} from "./tabs";

// 전체 내역 탭 본문 — 분류별 합계 요약(+ 조회 필터 폼). 이 탭에서만 지출 DB 조회.
async function AllExpensesTab({
  sp,
  user,
}: {
  sp: { clientId?: string; from?: string; to?: string };
  user: SessionUser;
}) {
  const ctx = getRlsContext(user);
  const clients = await listClients(ctx);

  const clientId = sp.clientId || undefined; // 기본 선택 없음 — 사용자가 검색해서 고른다.
  const [from, to] = orderRange(
    parseYm(sp.from) ?? { year: 2026, month: 1 },
    parseYm(sp.to) ?? parseYm(sp.from) ?? { year: 2026, month: 1 },
  );

  const totals = clientId ? await getExpenseSummaryTotals(ctx, clientId, from, to) : null;
  const rows = EXPENSE_SUMMARY_CATEGORIES.map((c) => ({
    key: c.key,
    label: c.label,
    amount: totals?.[c.key] ?? 0,
  }));

  return (
    <>
      {/* 필터 제출 시에도 전체 내역 탭 유지 */}
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <input type="hidden" name="tab" value="all" />
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          고객사
          <ClientCombobox clients={clients} defaultClientId={clientId} />
        </label>
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          시작
          <input type="month" name="from" defaultValue={ymValue(from)} className="mt-1 w-40 rounded border border-[var(--color-border)] px-3 py-2 text-sm" />
        </label>
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          종료
          <input type="month" name="to" defaultValue={ymValue(to)} className="mt-1 w-40 rounded border border-[var(--color-border)] px-3 py-2 text-sm" />
        </label>
        <button type="submit" className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white">조회</button>
      </form>

      {clients.length === 0 ? (
        <p className="text-[var(--color-muted)]">고객사가 없습니다.</p>
      ) : !clientId ? (
        <p className="text-[var(--color-muted)]">고객사를 선택하세요.</p>
      ) : (
        <ExpenseSummaryTable clientId={clientId} from={from} to={to} rows={rows} />
      )}
    </>
  );
}

// 지급 리스트 탭 본문 — 공용 원장. ADMIN·SETTLEMENT 전용이라 원문 그대로 표시.
async function PaymentListTab({
  sp,
  user,
}: {
  sp: { field?: string; q?: string };
  user: SessionUser;
}) {
  const ctx = getRlsContext(user);
  const parsedField = parsePayeeSearchField(sp.field);
  const field = parsedField ?? "bizName";
  const q = sp.q ?? "";
  const rows = await listPayees(ctx, parsedField && q.trim() ? { field: parsedField, q } : undefined);
  return <PayeeListPanel rows={rows} field={field} q={q} />;
}

// 아직 내용이 정해지지 않은 신규 탭용 자리표시자.
function PlaceholderTab({ label }: { label: string }) {
  return (
    <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-10 text-center text-[var(--color-muted)]">
      {label} 화면은 준비 중입니다.
    </div>
  );
}

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; clientId?: string; from?: string; to?: string; field?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const user = await requireUser();
  const role = user.role;
  // ACTIVE 사용자는 role 보유가 불변식. 방어적으로 처리(무한 리다이렉트 방지).
  if (!role) redirect("/");

  const tab = sp.tab ?? DEFAULT_EXPENSE_TAB;
  if (!canAccessExpenseTab(role, tab)) redirect("/expenses");
  const currentTab = tab as ExpenseTabKey;

  const tabs = visibleExpenseTabs(role);
  const currentLabel = tabs.find((t) => t.key === currentTab)?.label ?? "";

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">지출 입력</h1>
      <ExpenseTabs tabs={tabs} current={currentTab} />
      {currentTab === "all" ? (
        <AllExpensesTab sp={sp} user={user} />
      ) : currentTab === "payment-list" ? (
        <PaymentListTab sp={sp} user={user} />
      ) : (
        <PlaceholderTab label={currentLabel} />
      )}
    </div>
  );
}
