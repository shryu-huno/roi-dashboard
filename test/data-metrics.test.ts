import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS } from "@/lib/rls";
import { archiveClient, setClientEasywel } from "@/lib/data/clients";
import { mkClient, mkTask, setClientPms, projectIdOf } from "./factories";
import { createProject, updateProject } from "@/lib/data/projects";
import { createTask } from "@/lib/data/tasks";
import { upsertPerformanceBatch } from "@/lib/data/performance";
import { upsertExpense } from "@/lib/data/expenses";
import { getPeriodTotals, getContractTotal, getMonthlyTrend, getExpenseBreakdown, getClientSummaries, getPmSummaries, getClientDetail, getClientTaskMatrix, getClientProjectBreakdown, getClientLatestProjectProgress } from "@/lib/data/metrics";
import { attainment } from "@/lib/metrics/formulas";

const ADMIN = { userId: "seed-admin", role: "SUPER_ADMIN" as const };

async function reset() {
  await withRLS(ADMIN, async (tx) => {
    await tx.monthlyPerformance.deleteMany();
    await tx.invoice.deleteMany();
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
    clientA = (await mkClient(ADMIN, { name: "A사", pmIds: [pmA] })).id;
    taskA = (await mkTask(ADMIN, { clientId: clientA, name: "진단", unitPrice: 10000, contractCount: 50 })).id; // 계약금 500000
    clientB = (await mkClient(ADMIN, { name: "B사", pmIds: [pmB] })).id;
    taskB = (await mkTask(ADMIN, { clientId: clientB, name: "상담", unitPrice: 20000, contractCount: 40 })).id; // 계약금 800000
    // A사: 3월 실적 4회(40000), 지출 3월 5000, 청구 3월 30000, 입금 3월 20000
    await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2026, month: 3, rows: [{ taskId: taskA, count: 4, amount: null }] });
    await upsertExpense(ADMIN, { clientId: clientA, year: 2026, month: 3, category: "OPS_FOOD", amount: 5000 });
    // 청구/입금은 Invoice(VAT 포함 gross)에서 산출. 3월 발행 gross 33000(→off 30000, on 33000),
    // 3월 입금 gross 22000(→off 20000, on 22000)이 되도록 인보이스 2건을 넣는다.
    await withRLS(ADMIN, (tx) =>
      tx.invoice.createMany({
        data: [
          { clientId: clientA, amount: 22000, issueDate: new Date("2026-03-05"), paidDate: new Date("2026-03-25") },
          { clientId: clientA, amount: 11000, issueDate: new Date("2026-03-15") },
        ],
      }),
    );
    // A사: 8월 실적 2회(20000) — 하반기
    await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2026, month: 8, rows: [{ taskId: taskA, count: 2, amount: null }] });
    // B사: 3월 실적 1회(20000)
    await upsertPerformanceBatch(ADMIN, { clientId: clientB, year: 2026, month: 3, rows: [{ taskId: taskB, count: 1, amount: null }] });
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
    expect(await getContractTotal(ADMIN, 2026, "all")).toBe(1300000); // 500000 + 800000 (계약일 없음→ratio1)
    expect(await getContractTotal({ userId: pmA, role: "PM" }, 2026, "all")).toBe(500000); // A만
  });

  it("관리자는 고객사의 전 프로젝트를 기간 비례로 합산하고, PM은 최근 1건 전액만 본다", async () => {
    // A사에 시작일이 더 늦은 2026 전체 프로젝트(계약금 300000)를 추가한다.
    const proj = await createProject(ADMIN, clientA, {
      name: "2026 계약",
      contractStart: new Date("2026-01-01"),
      contractEnd: new Date("2026-12-31"),
      pmIds: [pmA],
    });
    await createTask(ADMIN, { clientId: clientA, projectId: proj.id, name: "신규", unitPrice: 10000, contractCount: 30 }); // 300000
    // 관리자(2026 전체): A사 기본(500000, 계약일 없음→ratio1) + 2026계약(300000, ratio1) + B사(800000).
    expect(await getContractTotal(ADMIN, 2026, "all")).toBe(1600000);
    // PM: 최근 프로젝트(2026계약) 1건 전액만.
    expect(await getContractTotal({ userId: pmA, role: "PM" }, 2026, "all")).toBe(300000);
  });

  it("두 해에 걸친 계약을 달력연도/기간 비례로 분모 계산한다 (관리자)", async () => {
    // 롯데형: 4~3월 계약 2건. 과업 계약금 1,200,000(=100,000×12)으로 월수 분배를 깔끔히.
    const c = (await mkClient(ADMIN, { name: "크로스사" })).id;
    const p1 = await createProject(ADMIN, c, { name: "2025~2026", contractStart: new Date("2025-04-01"), contractEnd: new Date("2026-03-31"), pmIds: [] });
    await createTask(ADMIN, { clientId: c, projectId: p1.id, name: "운영1", unitPrice: 100000, contractCount: 12 });
    const p2 = await createProject(ADMIN, c, { name: "2026~2027", contractStart: new Date("2026-04-01"), contractEnd: new Date("2027-03-31"), pmIds: [] });
    await createTask(ADMIN, { clientId: c, projectId: p2.id, name: "운영2", unitPrice: 100000, contractCount: 12 });

    // 2026 전체: 크로스사 = P1 3/12(1~3월)=300,000 + P2 9/12(4~12월)=900,000 = 1,200,000.
    //   A사500000 + B사800000(계약일 없음→ratio1) + 1,200,000 = 2,500,000.
    expect(await getContractTotal(ADMIN, 2026, "all")).toBe(2500000);
    // 2025 전체: 크로스사 = P1 9/12(4~12월)=900,000 + P2 0(2026시작) = 900,000.
    //   500000 + 800000 + 900,000 = 2,200,000.
    expect(await getContractTotal(ADMIN, 2025, "all")).toBe(2200000);
    // 2026 상반기(1~6월): 크로스사 = P1 3/12 + P2 3/12 = 600,000.
    //   A/B 계약일 없음 → 6/12: 250,000 + 400,000. 합 = 1,250,000.
    expect(await getContractTotal(ADMIN, 2026, "h1")).toBe(1250000);
  });

  it("PM은 비례하지 않고 최근 프로젝트 계약금 전액을 본다 (회귀)", async () => {
    const proj = await createProject(ADMIN, clientA, { name: "2026~2027", contractStart: new Date("2026-04-01"), contractEnd: new Date("2027-03-31"), pmIds: [pmA] });
    await createTask(ADMIN, { clientId: clientA, projectId: proj.id, name: "운영", unitPrice: 100000, contractCount: 12 }); // 1,200,000
    // PM: 최근 프로젝트 전액 — 기간/비례 무관.
    expect(await getContractTotal({ userId: pmA, role: "PM" }, 2026, "all")).toBe(1200000);
    expect(await getContractTotal({ userId: pmA, role: "PM" }, 2026, "h1")).toBe(1200000);
    // 관리자(2026 전체): A사 기본(500000) + 2026~2027(9/12=900,000) + B사(800000) = 2,200,000.
    expect(await getContractTotal(ADMIN, 2026, "all")).toBe(2200000);
  });

  it("includeVat=true applies ×1.1 to 실적/청구/입금/계약금 but NOT 지출", async () => {
    const t = await getPeriodTotals(ADMIN, 2026, "h1", true);
    expect(t.performance).toBe(66000); // 60000 × 1.1
    expect(t.billing).toBe(33000); // 30000 × 1.1
    expect(t.deposit).toBe(22000); // 20000 × 1.1
    expect(t.expense).toBe(5000); // 지출은 부가세 미포함(원장 원값) — VAT 토글 무관
    expect(await getContractTotal(ADMIN, 2026, "all", true)).toBe(1430000); // 1300000 × 1.1
  });

  it("면세 과업은 includeVat=true여도 계약금·실적에 ×1.1을 적용하지 않는다", async () => {
    // A사에 면세 과업 추가: 계약금 100000, 3월 실적 10000.
    const exempt = await mkTask(ADMIN, { clientId: clientA, name: "면세과업", unitPrice: 10000, contractCount: 10, vatExempt: true });
    await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2026, month: 3, rows: [{ taskId: exempt.id, count: 1, amount: null }] });

    // VAT 미포함: 면세/과세 모두 원값.
    expect(await getContractTotal(ADMIN, 2026, "all")).toBe(1400000); // 1300000 + 100000
    const off = await getPeriodTotals(ADMIN, 2026, "h1");
    expect(off.performance).toBe(70000); // 60000 + 10000

    // VAT 포함: 과세분만 ×1.1, 면세분은 원값.
    expect(await getContractTotal(ADMIN, 2026, "all", true)).toBe(1530000); // 1300000×1.1 + 100000
    const on = await getPeriodTotals(ADMIN, 2026, "h1", true);
    expect(on.performance).toBe(76000); // 60000×1.1 + 10000

    // 고객사 단위(요약·상세)도 동일하게 분리 적용.
    const sumA = (await getClientSummaries(ADMIN, 2026, "all", true)).find((r) => r.name === "A사")!;
    expect(sumA.contract).toBe(650000); // 500000×1.1 + 100000
    expect(sumA.performance).toBe(76000); // (40000+20000)×1.1 + 10000
    const detail = await getClientDetail(ADMIN, clientA, 2026, "all", true);
    expect(detail!.contract).toBe(650000);
    // 면세 과업의 월별 실적은 원값(3월 10000), 과세 과업은 ×1.1.
    const exemptRow = detail!.tasks.find((t) => t.name === "면세과업")!;
    expect(exemptRow.monthly.find((m) => m.month === 3)!.amount).toBe(10000);
    const taxableRow = detail!.tasks.find((t) => t.name === "진단")!;
    expect(taxableRow.monthly.find((m) => m.month === 3)!.amount).toBe(44000); // 40000×1.1
  });

  it("archived client is excluded from company-wide totals and contract", async () => {
    await archiveClient(ADMIN, clientB); // B사 보관
    const t = await getPeriodTotals(ADMIN, 2026, "h1");
    expect(t.performance).toBe(40000); // A사만 (B사 20000 제외)
    expect(await getContractTotal(ADMIN, 2026, "all")).toBe(500000); // A사 계약금만
    const trend = await getMonthlyTrend(ADMIN, 2026);
    expect(trend[2]).toMatchObject({ month: 3, performance: 40000 }); // 3월도 A사만
  });

  it("easywelOnly=true limits totals, contract, trend, and summaries to 현대이지웰 clients", async () => {
    await setClientEasywel(ADMIN, clientA, true); // A사만 현대이지웰
    const t = await getPeriodTotals(ADMIN, 2026, "h1", false, true);
    expect(t.performance).toBe(40000); // A사만 (B사 20000 제외)
    expect(await getContractTotal(ADMIN, 2026, "all", false, true)).toBe(500000); // A사 계약금만
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
    clientA = (await mkClient(ADMIN, { name: "A사", pmIds: [pmA] })).id;
    taskA = (await mkTask(ADMIN, { clientId: clientA, name: "진단", unitPrice: 10000 })).id;
    await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2026, month: 3, rows: [{ taskId: taskA, count: 4, amount: null }] });
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
    clientA = (await mkClient(ADMIN, { name: "A사", pmIds: [pmA] })).id;
    taskA = (await mkTask(ADMIN, { clientId: clientA, name: "진단", unitPrice: 10000, contractCount: 50 })).id; // 계약금 500000
    clientB = (await mkClient(ADMIN, { name: "B사", pmIds: [pmB] })).id;
    taskB = (await mkTask(ADMIN, { clientId: clientB, name: "상담", unitPrice: 20000, contractCount: 40 })).id; // 계약금 800000
    await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2026, month: 3, rows: [{ taskId: taskA, count: 4, amount: null }] });
    await upsertExpense(ADMIN, { clientId: clientA, year: 2026, month: 3, category: "OPS_FOOD", amount: 5000 });
    await upsertPerformanceBatch(ADMIN, { clientId: clientB, year: 2026, month: 3, rows: [{ taskId: taskB, count: 1, amount: null }] });
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
    await mkClient(ADMIN, { name: "C사", industry: "제조" });
    const rows = await getClientSummaries(ADMIN, 2026, "all");
    const c = rows.find((r) => r.name === "C사")!;
    expect(c.pmLabel).toBe("미배정");
    expect(c.industry).toBe("제조");
  });

  it("관리자 요약은 계약금을 연도 비례로 합산하고, PM은 전액을 본다", async () => {
    // A사에 2025~2026(4~3월) 프로젝트(1,200,000) 추가.
    const proj = await createProject(ADMIN, clientA, { name: "2025~2026", contractStart: new Date("2025-04-01"), contractEnd: new Date("2026-03-31"), pmIds: [pmA] });
    await createTask(ADMIN, { clientId: clientA, projectId: proj.id, name: "운영", unitPrice: 100000, contractCount: 12 });
    // 관리자(2026 전체): A사 = 기본(500000, ratio1) + 2025~2026(3/12=300,000) = 800,000.
    const adminRows = await getClientSummaries(ADMIN, 2026, "all");
    expect(adminRows.find((r) => r.name === "A사")!.contract).toBe(800000);
    // PM: 전 과업 전액 = 500000 + 1,200,000 = 1,700,000.
    const pmRows = await getClientSummaries({ userId: pmA, role: "PM" }, 2026, "all");
    expect(pmRows.find((r) => r.name === "A사")!.contract).toBe(1700000);
  });

  it("PM summaries roll up by pmId (ADMIN)", async () => {
    const rows = await getPmSummaries(ADMIN, 2026, "all");
    const a = rows.find((r) => r.pmId === pmA)!;
    expect(a).toMatchObject({ label: "PM A", clientCount: 1, performance: 40000, expense: 5000 });
    const b = rows.find((r) => r.pmId === pmB)!;
    expect(b).toMatchObject({ clientCount: 1, performance: 20000 });
  });

  it("multi-PM client: labels join and each PM gets full amount", async () => {
    await setClientPms(ADMIN, clientA, [pmA, pmB]); // A사 담당 2명(프로젝트 PM → ClientManager 동기화)
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
    clientA = (await mkClient(ADMIN, { name: "A사", pmIds: [pmA] })).id;
    taskA = (await mkTask(ADMIN, { clientId: clientA, name: "진단", unitPrice: 10000, contractCount: 50 })).id; // 계약금 500000
    await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2026, month: 3, rows: [{ taskId: taskA, count: 4, amount: null }] });
    // 청구/입금은 Invoice(VAT 포함 gross)에서 산출. 3월 발행 gross 33000(→off 30000, on 33000),
    // 3월 입금 gross 22000(→off 20000, on 22000)이 되도록 인보이스 2건을 넣는다.
    await withRLS(ADMIN, (tx) =>
      tx.invoice.createMany({
        data: [
          { clientId: clientA, amount: 22000, issueDate: new Date("2026-03-05"), paidDate: new Date("2026-03-25") },
          { clientId: clientA, amount: 11000, issueDate: new Date("2026-03-15") },
        ],
      }),
    );
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

  it("관리자 상세: 선택 프로젝트 계약금을 연도 비례로 분모 계산 (PM은 전액)", async () => {
    const proj = await createProject(ADMIN, clientA, { name: "2025~2026", contractStart: new Date("2025-04-01"), contractEnd: new Date("2026-03-31"), pmIds: [pmA] });
    await createTask(ADMIN, { clientId: clientA, projectId: proj.id, name: "운영", unitPrice: 100000, contractCount: 12 }); // 1,200,000
    // 2026 전체: 2025~2026 계약은 1~3월 3개월만 걸침 → 1,200,000 × 3/12 = 300,000.
    const d = await getClientDetail(ADMIN, clientA, 2026, "all", false, false, proj.id);
    expect(d!.contract).toBe(300000);
    // PM은 전액(1,200,000).
    const dp = await getClientDetail({ userId: pmA, role: "PM" }, clientA, 2026, "all", false, false, proj.id);
    expect(dp!.contract).toBe(1200000);
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

  it("과업을 저장된 순서(sortOrder)대로 반환한다", async () => {
    const projectId = await projectIdOf(ADMIN, clientA);
    // 기존 "진단" 외에 두 과업 추가 후, 설정 저장으로 역순(추가2·추가1·진단)으로 재배치한다.
    const t1 = await createTask(ADMIN, { clientId: clientA, projectId, name: "추가1", unitPrice: 1000 });
    const t2 = await createTask(ADMIN, { clientId: clientA, projectId, name: "추가2", unitPrice: 1000 });
    const res = await updateProject(ADMIN, projectId, {
      name: "기본 프로젝트",
      tasks: [
        { id: t2.id, name: "추가2", unitPrice: 1000, contractCount: null, contractAmount: null },
        { id: t1.id, name: "추가1", unitPrice: 1000, contractCount: null, contractAmount: null },
        { id: taskA, name: "진단", unitPrice: 10000, contractCount: 50, contractAmount: null },
      ],
    });
    expect(res.ok).toBe(true);
    const d = await getClientDetail(ADMIN, clientA, 2026, "all");
    expect(d!.tasks.map((t) => t.name)).toEqual(["추가2", "추가1", "진단"]);
  });

  it("task matrix: 계약기간이 없으면 fallback 연도 1~12월 12열", async () => {
    const projectId = await projectIdOf(ADMIN, clientA); // 기본 프로젝트(계약일 null)
    const m = await getClientTaskMatrix(ADMIN, clientA, projectId, false, 2026);
    expect(m).not.toBeNull();
    expect(m!.columns).toHaveLength(12);
    expect(m!.columns[0]).toEqual({ year: 2026, month: 1 });
    const t = m!.tasks[0];
    expect(t.name).toBe("진단");
    expect(t.total).toBe(40000);
    expect(t.cells.find((c) => c.year === 2026 && c.month === 3)!.amount).toBe(40000);
  });

  it("task matrix: 다년 계약을 계약 시작월부터 해를 넘겨 전개한다", async () => {
    const proj = await createProject(ADMIN, clientA, {
      name: "다년계약",
      contractStart: new Date("2025-06-01"),
      contractEnd: new Date("2026-05-31"),
      pmIds: [pmA],
    });
    const t = await createTask(ADMIN, { clientId: clientA, projectId: proj.id, name: "운영", unitPrice: 10000, contractCount: 12 });
    await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2025, month: 6, rows: [{ taskId: t.id, count: 1, amount: null }] });
    await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2026, month: 5, rows: [{ taskId: t.id, count: 2, amount: null }] });

    const m = await getClientTaskMatrix(ADMIN, clientA, proj.id, false, 2026);
    expect(m!.columns).toHaveLength(12);
    expect(m!.columns[0]).toEqual({ year: 2025, month: 6 });
    expect(m!.columns[11]).toEqual({ year: 2026, month: 5 });
    const row = m!.tasks.find((r) => r.name === "운영")!;
    expect(row.cells).toHaveLength(12);
    expect(row.cells[0]).toMatchObject({ year: 2025, month: 6, amount: 10000, count: 1 });
    expect(row.cells[11]).toMatchObject({ year: 2026, month: 5, amount: 20000, count: 2 });
    expect(row.total).toBe(30000); // 10000 + 20000, 계약 전체 합계
    expect(row.contract).toBe(120000); // unitPrice 10000 × contractCount 12 (진행률 분모)
    expect(row.contractCount).toBe(12);
  });

  it("task matrix: 과세 과업에 includeVat ×1.1 적용", async () => {
    const projectId = await projectIdOf(ADMIN, clientA);
    const m = await getClientTaskMatrix(ADMIN, clientA, projectId, true, 2026);
    const t = m!.tasks.find((r) => r.name === "진단")!;
    expect(t.cells.find((c) => c.month === 3)!.amount).toBe(44000); // 40000 × 1.1
  });

  it("task matrix: 다른 프로젝트라도 과업명이 같으면 한 행으로 합산한다", async () => {
    // 기본 프로젝트의 "진단"(2026-03 40000, 계약금 500000) 외에, 다른 프로젝트에도 "진단"을 둔다.
    const proj2 = await createProject(ADMIN, clientA, { name: "2026 추가", contractStart: new Date("2026-01-01"), contractEnd: new Date("2026-12-31"), pmIds: [pmA] });
    const t2 = await createTask(ADMIN, { clientId: clientA, projectId: proj2.id, name: "진단", unitPrice: 10000, contractCount: 10 }); // 계약금 100000
    await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2026, month: 5, rows: [{ taskId: t2.id, count: 2, amount: null }] });

    const m = await getClientTaskMatrix(ADMIN, clientA, undefined, false, 2026);
    const rows = m!.tasks.filter((r) => r.name === "진단");
    expect(rows).toHaveLength(1); // 두 프로젝트의 "진단"이 하나로 병합
    const r = rows[0];
    expect(r.cells.find((c) => c.month === 3)!.amount).toBe(40000); // 기본 프로젝트
    expect(r.cells.find((c) => c.month === 5)!.amount).toBe(20000); // 추가 프로젝트
    expect(r.total).toBe(60000);
    expect(r.contract).toBe(600000); // 500000 + 100000
    expect(r.contractCount).toBe(60); // 50 + 10
  });

  it("task matrix: 다른 PM의 고객사는 RLS로 null", async () => {
    const m = await getClientTaskMatrix({ userId: pmB, role: "PM" }, clientA, undefined, false, 2026);
    expect(m).toBeNull();
  });
});

describe("metrics: 상담비 집계 기준 (프로젝트=실시일시 / 회계연도=지급월)", () => {
  let clientA: string;
  beforeEach(async () => {
    await reset();
    clientA = (await mkClient(ADMIN, { name: "A사" })).id;
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

describe("metrics: 실적 계약 달성률(전년도 기준 실적)", () => {
  // 공통 픽스처: 2025 프로젝트(전년 실적) + 2026 실적계약 프로젝트를 가진 고객사.
  // 2025 실적: 3월 30000 + 8월 20000 = 50000(상반기 30000). 2026 실적: 3월 60000 + 8월 10000 = 70000.
  async function seedPerfContractClient(name: string) {
    const clientId = (await mkClient(ADMIN, { name })).id;
    const p25 = await createProject(ADMIN, clientId, { name: "2025", contractStart: new Date("2025-01-01"), contractEnd: new Date("2025-12-31"), pmIds: [] });
    const t25 = await createTask(ADMIN, { clientId, projectId: p25.id, name: "2025과업", unitPrice: 10000, contractCount: 20 });
    await upsertPerformanceBatch(ADMIN, { clientId, year: 2025, month: 3, rows: [{ taskId: t25.id, count: 3, amount: null }] });
    await upsertPerformanceBatch(ADMIN, { clientId, year: 2025, month: 8, rows: [{ taskId: t25.id, count: 2, amount: null }] });
    const p26 = await createProject(ADMIN, clientId, { name: "2026", contractStart: new Date("2026-01-01"), contractEnd: new Date("2026-12-31"), pmIds: [], performanceContract: true });
    const t26 = await createTask(ADMIN, { clientId, projectId: p26.id, name: "2026과업", unitPrice: 10000 }); // 실적계약: 계약금 없음
    await upsertPerformanceBatch(ADMIN, { clientId, year: 2026, month: 3, rows: [{ taskId: t26.id, count: 6, amount: null }] });
    await upsertPerformanceBatch(ADMIN, { clientId, year: 2026, month: 8, rows: [{ taskId: t26.id, count: 1, amount: null }] });
    return clientId;
  }

  beforeEach(reset);

  it("프로젝트별 요약: 실적계약 프로젝트의 baseline은 전년(2025) 같은 월 구간 합, 달성률=실적/baseline", async () => {
    const clientId = await seedPerfContractClient("실적사");
    const rows = await getClientProjectBreakdown(ADMIN, clientId, 2026);
    const r = rows.find((x) => x.performanceContract)!;
    expect(r.baseline).toBe(50000); // 2025 전체(1~12월) = 30000 + 20000
    expect(r.totalPerformance).toBe(70000); // 2026 프로젝트 전체 누적 = 60000 + 10000
    expect(attainment(r.totalPerformance, r.baseline)).toBeCloseTo(1.4); // 70000 / 50000
  });

  it("전년 실적이 없으면 baseline=0 → 달성률 산출 불가(UI는 '실적 계약' 유지)", async () => {
    const clientId = (await mkClient(ADMIN, { name: "첫해사" })).id;
    const p26 = await createProject(ADMIN, clientId, { name: "2026", contractStart: new Date("2026-01-01"), contractEnd: new Date("2026-12-31"), pmIds: [], performanceContract: true });
    const t26 = await createTask(ADMIN, { clientId, projectId: p26.id, name: "과업", unitPrice: 10000 });
    await upsertPerformanceBatch(ADMIN, { clientId, year: 2026, month: 3, rows: [{ taskId: t26.id, count: 5, amount: null }] });
    const rows = await getClientProjectBreakdown(ADMIN, clientId, 2026);
    const r = rows.find((x) => x.performanceContract)!;
    expect(r.baseline).toBe(0);
    expect(attainment(r.totalPerformance, r.baseline)).toBeNull();
  });

  it("baseline도 면세/과세 분리 — includeVat는 과세분에만 ×1.1", async () => {
    const clientId = (await mkClient(ADMIN, { name: "VAT사" })).id;
    // 2025: 과세 10000 + 면세 10000.
    const p25 = await createProject(ADMIN, clientId, { name: "2025", contractStart: new Date("2025-01-01"), contractEnd: new Date("2025-12-31"), pmIds: [] });
    const tTax = await createTask(ADMIN, { clientId, projectId: p25.id, name: "과세", unitPrice: 10000, vatExempt: false });
    const tEx = await createTask(ADMIN, { clientId, projectId: p25.id, name: "면세", unitPrice: 10000, vatExempt: true });
    await upsertPerformanceBatch(ADMIN, { clientId, year: 2025, month: 3, rows: [{ taskId: tTax.id, count: 1, amount: null }, { taskId: tEx.id, count: 1, amount: null }] });
    // 2026 실적계약 프로젝트(baseline을 읽기 위한 행).
    const p26 = await createProject(ADMIN, clientId, { name: "2026", contractStart: new Date("2026-01-01"), contractEnd: new Date("2026-12-31"), pmIds: [], performanceContract: true });
    await createTask(ADMIN, { clientId, projectId: p26.id, name: "과업", unitPrice: 10000 });

    const off = (await getClientProjectBreakdown(ADMIN, clientId, 2026, false)).find((x) => x.performanceContract)!;
    expect(off.baseline).toBe(20000); // 10000 + 10000
    const on = (await getClientProjectBreakdown(ADMIN, clientId, 2026, true)).find((x) => x.performanceContract)!;
    expect(on.baseline).toBe(21000); // 과세 10000×1.1 + 면세 10000
  });

  it("고객사 목록 진행률: 최근 프로젝트가 실적계약이면 baseline=전년 전체 실적", async () => {
    const clientId = await seedPerfContractClient("실적사2");
    const map = await getClientLatestProjectProgress(ADMIN, 2026);
    const e = map.get(clientId)!;
    expect(e.performanceContract).toBe(true);
    expect(e.baseline).toBe(50000); // 2025 전체
    expect(e.perf).toBe(70000); // 최근(2026) 프로젝트 올해 실적
    expect(attainment(e.perf, e.baseline)).toBeCloseTo(1.4);
  });

  it("실적 열(totalPerformance)은 연도/기준 토글과 무관하게 각 프로젝트의 전체 실적을 보여준다", async () => {
    const clientId = await seedPerfContractClient("토글무관사");
    // 회계연도 기준(true)/프로젝트 기준(false) × 2025/2026 네 조합 모두 동일해야 한다.
    const combos = [[2026, true], [2025, true], [2026, false], [2025, false]] as const;
    for (const [y, fiscal] of combos) {
      const rows = await getClientProjectBreakdown(ADMIN, clientId, y, false, fiscal);
      const r2026 = rows.find((r) => r.contractStart?.startsWith("2026"))!;
      const r2025 = rows.find((r) => r.contractStart?.startsWith("2025"))!;
      expect(r2026.totalPerformance).toBe(70000); // 2026 프로젝트
      expect(r2025.totalPerformance).toBe(50000); // 2025 프로젝트 — 다른 연도를 봐도 0이 아님
    }
  });

  it("회귀: 금액계약 프로젝트는 기존대로 계약금 분모(달성률=totalPerformance/contract)", async () => {
    const clientId = (await mkClient(ADMIN, { name: "금액사" })).id;
    const p = await createProject(ADMIN, clientId, { name: "2026", contractStart: new Date("2026-01-01"), contractEnd: new Date("2026-12-31"), pmIds: [] });
    const t = await createTask(ADMIN, { clientId, projectId: p.id, name: "과업", unitPrice: 10000, contractCount: 10 }); // 계약금 100000
    await upsertPerformanceBatch(ADMIN, { clientId, year: 2026, month: 3, rows: [{ taskId: t.id, count: 5, amount: null }] }); // 50000
    const r = (await getClientProjectBreakdown(ADMIN, clientId, 2026)).find((x) => x.id === p.id)!;
    expect(r.performanceContract).toBe(false);
    expect(r.contract).toBe(100000);
    expect(r.totalPerformance).toBe(50000);
    expect(attainment(r.totalPerformance, r.contract)).toBeCloseTo(0.5);
  });
});
