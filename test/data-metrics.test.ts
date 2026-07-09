import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS } from "@/lib/rls";
import { createClient } from "@/lib/data/clients";
import { createTask } from "@/lib/data/tasks";
import { upsertPerformanceBatch } from "@/lib/data/performance";
import { upsertExpense } from "@/lib/data/expenses";
import { upsertBilling, upsertDeposit } from "@/lib/data/billing";
import { getPeriodTotals, getContractTotal } from "@/lib/data/metrics";

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
    clientA = (await createClient(ADMIN, { name: "A사", pmId: pmA })).id;
    taskA = (await createTask(ADMIN, { clientId: clientA, name: "진단", unitPrice: 10000, contractCount: 50 })).id; // 계약금 500000
    clientB = (await createClient(ADMIN, { name: "B사", pmId: pmB })).id;
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
});
