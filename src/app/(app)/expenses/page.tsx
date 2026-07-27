import { redirect } from "next/navigation";
import { requireUser, type SessionUser } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { listClients } from "@/lib/data/clients";
import { listExpenses } from "@/lib/data/expenses";
import { listPayees } from "@/lib/data/payees";
import { EXPENSE_CATEGORIES } from "@/lib/validation/schemas";
import { ExpenseForm } from "./ExpenseForm";
import { ExpenseTabs } from "./ExpenseTabs";
import { PayeeListPanel } from "./PayeeListPanel";
import {
  DEFAULT_EXPENSE_TAB,
  canAccessExpenseTab,
  visibleExpenseTabs,
  type ExpenseTabKey,
} from "./tabs";

// 전체 내역 탭 본문 — 기존 카테고리 그리드(+ 조회 필터 폼). 이 탭에서만 지출 DB 조회.
async function AllExpensesTab({
  sp,
  user,
}: {
  sp: { clientId?: string; year?: string; month?: string };
  user: SessionUser;
}) {
  const ctx = getRlsContext(user);
  const clients = await listClients(ctx);

  const clientId = sp.clientId ?? clients[0]?.id;
  const year = Number(sp.year) || 2026;
  const month = Number(sp.month) || 1;

  const existing = clientId ? await listExpenses(ctx, clientId, year, month) : [];
  const byCat = new Map(existing.map((e) => [e.category, e]));
  const rows = EXPENSE_CATEGORIES.map((category) => ({
    category,
    amount: (byCat.get(category)?.amount ?? "") as number | "",
    memo: byCat.get(category)?.memo ?? "",
  }));

  return (
    <>
      {/* 필터 제출 시에도 전체 내역 탭 유지 */}
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <input type="hidden" name="tab" value="all" />
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
        <p className="text-[var(--color-muted)]">고객사가 없습니다.</p>
      ) : (
        <ExpenseForm clientId={clientId} year={year} month={month} rows={rows} />
      )}
    </>
  );
}

// 지급 리스트 탭 본문 — 공용 원장. ADMIN·SETTLEMENT 전용이라 원문 그대로 표시.
async function PaymentListTab({ user }: { user: SessionUser }) {
  const ctx = getRlsContext(user);
  const rows = await listPayees(ctx);
  return <PayeeListPanel rows={rows} />;
}

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; clientId?: string; year?: string; month?: string }>;
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

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">지출 입력</h1>
      <ExpenseTabs tabs={tabs} current={currentTab} />
      {currentTab === "all" ? (
        <AllExpensesTab sp={sp} user={user} />
      ) : (
        <PaymentListTab user={user} />
      )}
    </div>
  );
}
