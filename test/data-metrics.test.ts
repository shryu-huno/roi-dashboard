import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS } from "@/lib/rls";
import { createClient, updateClient, archiveClient, setClientEasywel } from "@/lib/data/clients";
import { createTask } from "@/lib/data/tasks";
import { upsertPerformanceBatch } from "@/lib/data/performance";
import { upsertExpense } from "@/lib/data/expenses";
import { upsertBilling, upsertDeposit } from "@/lib/data/billing";
import { getPeriodTotals, getContractTotal, getMonthlyTrend, getExpenseBreakdown, getClientSummaries, getPmSummaries, getClientDetail } from "@/lib/data/metrics";

const ADMIN = { userId: "seed-admin", role: "ADMIN" as const };

async function reset() {
  await withRLS(ADMIN, async (tx) => {
    await tx.monthlyPerformance.deleteMany();
    await tx.monthlyBilling.deleteMany();
    await tx.monthlyDeposit.deleteMany();
    await tx.expense.deleteMany();
    await tx.task.deleteMany();
    await tx.client.deleteMany();
  });
  await prisma.user.deleteMany();
}

describe("metrics: period totals & contract total", () => {
  let pmA: string, pmB: string, clientA: string, taskA: string, clientB: string, taskB: string;
  beforeEach(async () => {
    await reset();
    pmA = (await prisma.user.create({ data: { email: "pma@huno.kr", role: "PM", status: "ACTIVE" } })).id;
    pmB = (await prisma.user.create({ data: { email: "pmb@huno.kr", role: "PM", status: "ACTIVE" } })).id;
    clientA = (await createClient(ADMIN, { name: "A사", pmIds: [pmA] })).id;
    taskA = (await createTask(ADMIN, { clientId: clientA, name: "진단", unitPrice: 10000, contractCount: 50 })).id; // 계약금 500000
    clientB = (await createClient(ADMIN, { name: "B사", pmIds: [pmB] })).id;
    taskB = (await createTask(ADMIN, { clientId: clientB, name: "상담", unitPrice: 20000, contractCount: 40 })).id; // 계약금 800000
    // A사: 3월 실적 4회(40000), 지출 3월 5000, 청구 3월 30000, 입금 3월 20000
    await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2026, month: 3, rows: [{ taskId: taskA, count: 4 }] });
    await upsertExpense(ADMIN, { clientId: clientA, year: 2026, month: 3, category: "OPS_FOOD", amount: 5000 });
    await upsertBilling(ADMIN, { clientId: clientA, year: 2026, month: 3, amount: 30000 });
    await upsertDeposit(ADMIN, { clientId: clientA, year: 2026, month: 3, amount: 20000 });
    // A사: 8월 실적 2회(20000) — 하반기
    await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2026, month: 8, rows: [{ taskId: taskA, count: 2 }] });
    // B사: 3월 실적 1회(20000)
    await upsertPerformanceBatch(ADMIN, { clientId: clientB, year: 2026, month: 3, rows: [{ taskId: taskB, count: 1 }] });
  });

  it("ADMIN sees all clients' totals for H1", async () => {
    const t = await getPeriodTotals(ADMIN, 2026, "h1");
    expect(t.performance).toBe(60000); // A 40000 + B 20000 (both 3월)
    expect(t.billing).toBe(30000);
    expect(t.deposit).toBe(20000);
    expect(t.expense).toBe(5000);
  });

  it("period filter narrows to a single month", async () => {
    const t = await getPeriodTotals(ADMIN, 2026, "8");
    expect(t.performance).toBe(20000); // A 8월만
  });

  it("PM A totals include only own client (RLS)", async () => {
    const t = await getPeriodTotals({ userId: pmA, role: "PM" }, 2026, "all");
    expect(t.performance).toBe(60000); // A 3월40000 + 8월20000, B 제외
  });

  it("contract total sums Task.contractAmount, RLS-scoped", async () => {
    expect(await getContractTotal(ADMIN)).toBe(1300000); // 500000 + 800000
    expect(await getContractTotal({ userId: pmA, role: "PM" })).toBe(500000); // A만
  });

  it("includeVat=true applies ×1.1 to 실적/청구/입금/계약금 but NOT 지출", async () => {
    const t = await getPeriodTotals(ADMIN, 2026, "h1", true);
    expect(t.performance).toBe(66000); // 60000 × 1.1
    expect(t.billing).toBe(33000); // 30000 × 1.1
    expect(t.deposit).toBe(22000); // 20000 × 1.1
    expect(t.expense).toBe(5000); // 지출은 부가세 미포함(원장 원값) — VAT 토글 무관
    expect(await getContractTotal(ADMIN, true)).toBe(1430000); // 1300000 × 1.1
  });

  it("archived client is excluded from company-wide totals and contract", async () => {
    await archiveClient(ADMIN, clientB); // B사 보관
    const t = await getPeriodTotals(ADMIN, 2026, "h1");
    expect(t.performance).toBe(40000); // A사만 (B사 20000 제외)
    expect(await getContractTotal(ADMIN)).toBe(500000); // A사 계약금만
    const trend = await getMonthlyTrend(ADMIN, 2026);
    expect(trend[2]).toMatchObject({ month: 3, performance: 40000 }); // 3월도 A사만
  });

  it("easywelOnly=true limits totals, contract, trend, and summaries to 현대이지웰 clients", async () => {
    await setClientEasywel(ADMIN, clientA, true); // A사만 현대이지웰
    const t = await getPeriodTotals(ADMIN, 2026, "h1", false, true);
    expect(t.performance).toBe(40000); // A사만 (B사 20000 제외)
    expect(await getContractTotal(ADMIN, false, true)).toBe(500000); // A사 계약금만
    const trend = await getMonthlyTrend(ADMIN, 2026, false, true);
    expect(trend[2]).toMatchObject({ month: 3, performance: 40000 });
    const rows = await getClientSummaries(ADMIN, 2026, "all", false, true);
    expect(rows.map((r) => r.name)).toEqual(["A사"]);
  });
});

describe("metrics: trend & expense breakdown", () => {
  let pmA: string, clientA: string, taskA: string;
  beforeEach(async () => {
    await reset();
    pmA = (await prisma.user.create({ data: { email: "pma@huno.kr", role: "PM", status: "ACTIVE" } })).id;
    clientA = (await createClient(ADMIN, { name: "A사", pmIds: [pmA] })).id;
    taskA = (await createTask(ADMIN, { clientId: clientA, name: "진단", unitPrice: 10000 })).id;
    await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2026, month: 3, rows: [{ taskId: taskA, count: 4 }] });
    await upsertExpense(ADMIN, { clientId: clientA, year: 2026, month: 3, category: "OPS_FOOD", amount: 5000 });
    await upsertExpense(ADMIN, { clientId: clientA, year: 2026, month: 3, category: "OPS_TRANSPORT", amount: 3000 });
  });

  it("returns 12 months, zero-filled", async () => {
    const trend = await getMonthlyTrend(ADMIN, 2026);
    expect(trend).toHaveLength(12);
    expect(trend[2]).toEqual({ month: 3, performance: 40000, expense: 8000 });
    expect(trend[0]).toEqual({ month: 1, performance: 0, expense: 0 });
  });

  it("breaks expenses down by category for the period", async () => {
    const slices = await getExpenseBreakdown(ADMIN, 2026, "h1");
    const byCat = Object.fromEntries(slices.map((s) => [s.category, s.amount]));
    expect(byCat["OPS_FOOD"]).toBe(5000);
    expect(byCat["OPS_TRANSPORT"]).toBe(3000);
  });
});

describe("metrics: client & PM summaries", () => {
  let pmA: string, pmB: string, clientA: string, taskA: string, clientB: string, taskB: string;
  beforeEach(async () => {
    await reset();
    pmA = (await prisma.user.create({ data: { email: "pma@huno.kr", name: "PM A", role: "PM", status: "ACTIVE" } })).id;
    pmB = (await prisma.user.create({ data: { email: "pmb@huno.kr", name: "PM B", role: "PM", status: "ACTIVE" } })).id;
    clientA = (await createClient(ADMIN, { name: "A사", pmIds: [pmA] })).id;
    taskA = (await createTask(ADMIN, { clientId: clientA, name: "진단", unitPrice: 10000, contractCount: 50 })).id; // 계약금 500000
    clientB = (await createClient(ADMIN, { name: "B사", pmIds: [pmB] })).id;
    taskB = (await createTask(ADMIN, { clientId: clientB, name: "상담", unitPrice: 20000, contractCount: 40 })).id; // 계약금 800000
    await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2026, month: 3, rows: [{ taskId: taskA, count: 4 }] });
    await upsertExpense(ADMIN, { clientId: clientA, year: 2026, month: 3, category: "OPS_FOOD", amount: 5000 });
    await upsertPerformanceBatch(ADMIN, { clientId: clientB, year: 2026, month: 3, rows: [{ taskId: taskB, count: 1 }] });
  });

  it("client summaries per client (ADMIN)", async () => {
    const rows = await getClientSummaries(ADMIN, 2026, "all");
    expect(rows.map((r) => r.name)).toEqual(["A사", "B사"]);
    const a = rows.find((r) => r.name === "A사")!;
    expect(a).toMatchObject({ performance: 40000, expense: 5000, contract: 500000 });
    expect(a.pms).toEqual([{ id: pmA, label: "PM A" }]);
  });

  it("PM A sees only own client summary (RLS)", async () => {
    const rows = await getClientSummaries({ userId: pmA, role: "PM" }, 2026, "all");
    expect(rows.map((r) => r.name)).toEqual(["A사"]);
  });

  it("client summaries include pmLabel", async () => {
    const rows = await getClientSummaries(ADMIN, 2026, "all");
    expect(rows.find((r) => r.name === "A사")!.pmLabel).toBe("PM A");
    expect(rows.find((r) => r.name === "B사")!.pmLabel).toBe("PM B");
  });

  it("client summary uses 미배정 for no PM and returns industry", async () => {
    await createClient(ADMIN, { name: "C사", industry: "제조" });
    const rows = await getClientSummaries(ADMIN, 2026, "all");
    const c = rows.find((r) => r.name === "C사")!;
    expect(c.pmLabel).toBe("미배정");
    expect(c.industry).toBe("제조");
  });

  it("PM summaries roll up by pmId (ADMIN)", async () => {
    const rows = await getPmSummaries(ADMIN, 2026, "all");
    const a = rows.find((r) => r.pmId === pmA)!;
    expect(a).toMatchObject({ label: "PM A", clientCount: 1, performance: 40000, expense: 5000 });
    const b = rows.find((r) => r.pmId === pmB)!;
    expect(b).toMatchObject({ clientCount: 1, performance: 20000 });
  });

  it("multi-PM client: labels join and each PM gets full amount", async () => {
    await updateClient(ADMIN, clientA, { name: "A사", pmIds: [pmA, pmB] }); // A사 담당 2명
    const summaries = await getClientSummaries(ADMIN, 2026, "all");
    expect(summaries.find((r) => r.name === "A사")!.pmLabel).toBe("PM A, PM B");

    const rows = await getPmSummaries(ADMIN, 2026, "all");
    // A사 실적 40000이 두 PM 모두에 전액 반영. B는 자기 B사 20000 + A사 40000.
    expect(rows.find((r) => r.pmId === pmA)!).toMatchObject({ clientCount: 1, performance: 40000 });
    expect(rows.find((r) => r.pmId === pmB)!).toMatchObject({ clientCount: 2, performance: 60000 });
  });
});

describe("metrics: client detail", () => {
  let pmA: string, pmB: string, clientA: string, taskA: string;
  beforeEach(async () => {
    await reset();
    pmA = (await prisma.user.create({ data: { email: "pma@huno.kr", role: "PM", status: "ACTIVE" } })).id;
    pmB = (await prisma.user.create({ data: { email: "pmb@huno.kr", role: "PM", status: "ACTIVE" } })).id;
    clientA = (await createClient(ADMIN, { name: "A사", pmIds: [pmA] })).id;
    taskA = (await createTask(ADMIN, { clientId: clientA, name: "진단", unitPrice: 10000, contractCount: 50 })).id; // 계약금 500000
    await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2026, month: 3, rows: [{ taskId: taskA, count: 4 }] });
    await upsertBilling(ADMIN, { clientId: clientA, year: 2026, month: 3, amount: 30000 });
    await upsertDeposit(ADMIN, { clientId: clientA, year: 2026, month: 3, amount: 20000 });
  });

  it("returns detail with per-task monthly amounts and contract total", async () => {
    const d = await getClientDetail(ADMIN, clientA, 2026, "all");
    expect(d).not.toBeNull();
    expect(d!.client.name).toBe("A사");
    expect(d!.contract).toBe(500000);
    const t = d!.tasks[0];
    expect(t.name).toBe("진단");
    expect(t.total).toBe(40000);
    expect(t.monthly).toHaveLength(12);
    expect(t.monthly.find((m) => m.month === 3)!.amount).toBe(40000);
    expect(t.monthly.find((m) => m.month === 1)!.amount).toBe(0);
    expect(d!.monthly).toHaveLength(12);
    expect(d!.monthly[2]).toEqual({ month: 3, performance: 40000, billing: 30000, deposit: 20000, expense: 0 });
  });

  it("task monthly columns follow the selected period (h1 → months 1..6)", async () => {
    const d = await getClientDetail(ADMIN, clientA, 2026, "h1");
    expect(d!.tasks[0].monthly.map((m) => m.month)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(d!.tasks[0].total).toBe(40000);
  });

  it("returns null for another PM's client (RLS)", async () => {
    const d = await getClientDetail({ userId: pmB, role: "PM" }, clientA, 2026, "all");
    expect(d).toBeNull();
  });
});

describe("metrics: 상담비 집계 기준 (프로젝트=실시일시 / 회계연도=지급월)", () => {
  let clientA: string;
  beforeEach(async () => {
    await reset();
    clientA = (await createClient(ADMIN, { name: "A사" })).id;
    // 실시일시와 지급월이 어긋나는 상담비 2건을 넣어 기준별 집계 차이를 만든다.
    await withRLS(ADMIN, (tx) =>
      tx.consultingExpense.createMany({
        data: [
          // 실시 2026-03(상반기), 지급 2026-07(하반기)
          { clientId: clientA, clientName: "A사", field: "심리상담", sessionDate: "2026-03-15", year: 2026, month: 7, amount: 100000 },
          // 실시 2025-12(2026년 범위 밖), 지급 2026-01(상반기)
          { clientId: clientA, clientName: "A사", field: "심리상담", sessionDate: "2025-12-20", year: 2026, month: 1, amount: 50000 },
        ],
      }),
    );
  });

  it("프로젝트 기준: 상담비를 실시일시로 집계", async () => {
    // 상반기(1~6월) 실시 = 2026-03 건만 → 100000. (지급 2026-07 건은 실시일이 6월 이후라 제외, 2025-12 건도 제외)
    const h1 = await getPeriodTotals(ADMIN, 2026, "h1", false, false, false);
    expect(h1.expense).toBe(100000);
    // 2026 전체 실시 = 2026-03 건만(2025-12 건은 2026 범위 밖) → 100000.
    const all = await getPeriodTotals(ADMIN, 2026, "all", false, false, false);
    expect(all.expense).toBe(100000);
  });

  it("회계연도 기준: 상담비를 지급월로 집계", async () => {
    // 상반기(1~6월) 지급 = 2026-01 건만 → 50000. (지급 2026-07 건은 하반기라 제외)
    const h1 = await getPeriodTotals(ADMIN, 2026, "h1", false, false, true);
    expect(h1.expense).toBe(50000);
    // 2026 전체 지급 = 두 건 모두 → 150000.
    const all = await getPeriodTotals(ADMIN, 2026, "all", false, false, true);
    expect(all.expense).toBe(150000);
  });

  it("월별 추이도 기준을 따른다", async () => {
    const proj = await getMonthlyTrend(ADMIN, 2026, false, false, false);
    expect(proj.find((t) => t.month === 3)!.expense).toBe(100000); // 실시 3월
    expect(proj.find((t) => t.month === 7)!.expense).toBe(0);
    const fisc = await getMonthlyTrend(ADMIN, 2026, false, false, true);
    expect(fisc.find((t) => t.month === 7)!.expense).toBe(100000); // 지급 7월
    expect(fisc.find((t) => t.month === 1)!.expense).toBe(50000); // 지급 1월
  });
});
