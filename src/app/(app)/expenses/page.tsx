import { redirect } from "next/navigation";
import { requireUser, type SessionUser } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { listClients } from "@/lib/data/clients";
import { getConsultingFieldSummary, getCorporateCardSummary, getExpenseSummaryTotals } from "@/lib/data/expenses";
import { listPayees, listPayeesForPm, parsePage, parsePayeeSearchField, parsePayeePmSearchField } from "@/lib/data/payees";
import { EXPENSE_SUMMARY_CATEGORIES } from "@/lib/expense-summary";
import { orderRange, parseYm, rangeLabel, ymValue } from "@/lib/month-range";
import { ClientCombobox } from "@/components/ClientCombobox";
import { ConsultingSummaryTable } from "./ConsultingSummaryTable";
import { CorporateCardSummaryTable } from "./CorporateCardSummaryTable";
import { ExpenseSummaryTable } from "./ExpenseSummaryTable";
import { ExpenseTabs } from "./ExpenseTabs";
import { PayeeListPanel } from "./PayeeListPanel";
import { PayeePmListPanel } from "./PayeePmListPanel";
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

// 상담비 탭 본문 — 상담분야별 합계(+ 조회 필터). 고객사는 선택(비우면 전체),
// 기본값은 RLS 범위 전체(관리자·정산=모든 고객사, PM=담당 고객사)로 조회한다.
async function ConsultingTab({
  sp,
  user,
}: {
  sp: { clientId?: string; from?: string; to?: string };
  user: SessionUser;
}) {
  const ctx = getRlsContext(user);
  const clients = await listClients(ctx);

  const clientId = sp.clientId || undefined; // 비우면 전체(역할별 RLS 범위).
  const [from, to] = orderRange(
    parseYm(sp.from) ?? { year: 2026, month: 1 },
    parseYm(sp.to) ?? { year: 2026, month: 12 },
  );

  const { rows, total, totalCount } = await getConsultingFieldSummary(ctx, { clientId, from, to });
  const selectedName = clientId ? clients.find((c) => c.id === clientId)?.name : undefined;

  return (
    <>
      {/* 필터 제출 시에도 상담비 탭 유지. 고객사를 비우면 전체 범위로 조회. */}
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <input type="hidden" name="tab" value="consulting" />
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

      <p className="mb-3 text-sm text-[var(--color-muted)]">
        {selectedName ?? "전체 고객사"} · {rangeLabel(from, to)}
      </p>

      {rows.length === 0 ? (
        <p className="text-[var(--color-muted)]">해당 조건의 상담비 내역이 없습니다.</p>
      ) : (
        <ConsultingSummaryTable rows={rows} total={total} totalCount={totalCount} />
      )}
    </>
  );
}

// 법인카드 탭 본문 — 항목별 합계(+ 조회 필터). 상담비와 동일하되 상담분야 대신 항목,
// 건수 없이 금액만. 고객사는 선택(비우면 전체 RLS 범위).
async function CorporateCardTab({
  sp,
  user,
}: {
  sp: { clientId?: string; from?: string; to?: string };
  user: SessionUser;
}) {
  const ctx = getRlsContext(user);
  const clients = await listClients(ctx);

  const clientId = sp.clientId || undefined; // 비우면 전체(역할별 RLS 범위).
  const [from, to] = orderRange(
    parseYm(sp.from) ?? { year: 2026, month: 1 },
    parseYm(sp.to) ?? { year: 2026, month: 12 },
  );

  const { rows, total } = await getCorporateCardSummary(ctx, { clientId, from, to });
  const selectedName = clientId ? clients.find((c) => c.id === clientId)?.name : undefined;

  return (
    <>
      {/* 필터 제출 시에도 법인카드 탭 유지. 고객사를 비우면 전체 범위로 조회. */}
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <input type="hidden" name="tab" value="corporate-card" />
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

      <p className="mb-3 text-sm text-[var(--color-muted)]">
        {selectedName ?? "전체 고객사"} · {rangeLabel(from, to)}
      </p>

      {rows.length === 0 ? (
        <p className="text-[var(--color-muted)]">해당 조건의 법인카드 내역이 없습니다.</p>
      ) : (
        <CorporateCardSummaryTable rows={rows} total={total} />
      )}
    </>
  );
}

// 지급 리스트 탭 본문 — 공용 원장. ADMIN·SETTLEMENT 전용이라 원문 그대로 표시.
async function PaymentListTab({
  sp,
  user,
}: {
  sp: { field?: string; q?: string; page?: string };
  user: SessionUser;
}) {
  const ctx = getRlsContext(user);
  const page = parsePage(sp.page);

  if (user.role === "PM") {
    const parsedField = parsePayeePmSearchField(sp.field);
    const field = parsedField ?? "bizName";
    const q = parsedField ? (sp.q ?? "") : "";
    const result = await listPayeesForPm(ctx, parsedField && q.trim() ? { field: parsedField, q } : undefined, page);
    return <PayeePmListPanel rows={result.rows} field={field} q={q} page={result.page} totalPages={result.totalPages} />;
  }

  const parsedField = parsePayeeSearchField(sp.field);
  const field = parsedField ?? "bizName";
  const q = parsedField ? (sp.q ?? "") : "";
  const result = await listPayees(ctx, parsedField && q.trim() ? { field: parsedField, q } : undefined, page);
  return <PayeeListPanel rows={result.rows} field={field} q={q} page={result.page} totalPages={result.totalPages} />;
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
  searchParams: Promise<{ tab?: string; clientId?: string; from?: string; to?: string; field?: string; q?: string; page?: string }>;
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
      ) : currentTab === "consulting" ? (
        <ConsultingTab sp={sp} user={user} />
      ) : currentTab === "corporate-card" ? (
        <CorporateCardTab sp={sp} user={user} />
      ) : currentTab === "payment-list" ? (
        <PaymentListTab sp={sp} user={user} />
      ) : (
        <PlaceholderTab label={currentLabel} />
      )}
    </div>
  );
}
