import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS } from "@/lib/rls";
import { upsertPerformanceBatch, listPerformance, listPerformanceTotals } from "@/lib/data/performance";
import { createProject, updateProject } from "@/lib/data/projects";
import { createTask, updateTask } from "@/lib/data/tasks";
import { mkClient, mkTask, projectIdOf } from "./factories";

const ADMIN = { userId: "seed-admin", role: "SUPER_ADMIN" as const };

async function reset() {
  await withRLS(ADMIN, async (tx) => {
    await tx.monthlyPerformance.deleteMany();
    await tx.task.deleteMany();
    await tx.client.deleteMany();
  });
  await prisma.user.deleteMany();
}

describe("performance data layer", () => {
  let pmA: string, pmB: string, clientA: string, taskA1: string, clientB: string, taskB1: string;
  beforeEach(async () => {
    await reset();
    pmA = (await prisma.user.create({ data: { email: "pma@huno.kr", role: "PM", status: "ACTIVE" } })).id;
    pmB = (await prisma.user.create({ data: { email: "pmb@huno.kr", role: "PM", status: "ACTIVE" } })).id;
    clientA = (await mkClient(ADMIN, { name: "A사", pmIds: [pmA] })).id;
    taskA1 = (await mkTask(ADMIN, { clientId: clientA, name: "심리진단", unitPrice: 10000 })).id;
    clientB = (await mkClient(ADMIN, { name: "B사", pmIds: [pmB] })).id;
    taskB1 = (await mkTask(ADMIN, { clientId: clientB, name: "상담", unitPrice: 20000 })).id;
  });

  it("computes amount = unitPrice * count on save", async () => {
    const res = await upsertPerformanceBatch({ userId: pmA, role: "PM" }, { clientId: clientA, year: 2026, month: 3, rows: [{ taskId: taskA1, count: 4, amount: null }] });
    expect(res.ok).toBe(true);
    const rows = await listPerformance(ADMIN, clientA, 2026, 3);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(40000);
    expect(rows[0].count).toBe(4);
  });

  it("소수 횟수를 저장하고, 파생 금액은 원 단위 정수로 반올림한다", async () => {
    // 0.6회 × 10000 = 6000(정확). 단가가 반올림을 유발하는 경우도 함께 검증.
    const res = await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2026, month: 4, rows: [{ taskId: taskA1, count: 0.6, amount: null }] });
    expect(res.ok).toBe(true);
    const rows = await listPerformance(ADMIN, clientA, 2026, 4);
    expect(rows[0].count).toBe(0.6);
    expect(rows[0].amount).toBe(6000);

    // 단가 3333 × 0.6 = 1999.8 → 2000으로 반올림.
    const t2 = (await mkTask(ADMIN, { clientId: clientA, name: "부분상담", unitPrice: 3333 })).id;
    await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2026, month: 4, rows: [{ taskId: t2, count: 0.6, amount: null }] });
    const rows2 = await listPerformance(ADMIN, clientA, 2026, 4);
    const rec = rows2.find((r) => r.taskId === t2)!;
    expect(rec.count).toBe(0.6);
    expect(rec.amount).toBe(2000);
  });

  it("단가 변경 시 횟수 모드 실적 금액을 새 단가로 다시 계산한다(updateTask)", async () => {
    // 3월: 횟수 모드 4회 → 40000, 5월: 금액 직접입력 500000(count null).
    await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2026, month: 3, rows: [{ taskId: taskA1, count: 4, amount: null }] });
    await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2026, month: 5, rows: [{ taskId: taskA1, count: null, amount: 500000 }] });

    await updateTask(ADMIN, taskA1, { name: "심리진단", unitPrice: 12000, contractCount: null });

    const mar = await listPerformance(ADMIN, clientA, 2026, 3);
    expect(mar[0].amount).toBe(48000); // 12000 × 4 (옛 40000이 아님)
    const may = await listPerformance(ADMIN, clientA, 2026, 5);
    expect(may[0].amount).toBe(500000); // 금액 직접입력 모드는 그대로
  });

  it("단가 변경 시 프로젝트 저장(updateProject) 경로에서도 실적 금액을 다시 계산한다", async () => {
    await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2026, month: 6, rows: [{ taskId: taskA1, count: 3, amount: null }] });
    const projectId = await projectIdOf(ADMIN, clientA);
    await updateProject(ADMIN, projectId, {
      name: "기본 프로젝트",
      tasks: [{ id: taskA1, name: "심리진단", unitPrice: 20000, contractCount: null, contractAmount: null }],
    });
    const jun = await listPerformance(ADMIN, clientA, 2026, 6);
    expect(jun[0].amount).toBe(60000); // 20000 × 3 (옛 30000이 아님)
  });

  it("stores amount directly and leaves count null in amount mode", async () => {
    const res = await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2026, month: 3, rows: [{ taskId: taskA1, count: null, amount: 500000 }] });
    expect(res.ok).toBe(true);
    const rows = await listPerformance(ADMIN, clientA, 2026, 3);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(500000); // 단가×횟수가 아니라 입력 금액 그대로
    expect(rows[0].count).toBeNull();
  });

  it("upsert is idempotent on (task, year, month)", async () => {
    await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2026, month: 3, rows: [{ taskId: taskA1, count: 4, amount: null }] });
    await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2026, month: 3, rows: [{ taskId: taskA1, count: 7, amount: null }] });
    const rows = await listPerformance(ADMIN, clientA, 2026, 3);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(7);
    expect(rows[0].amount).toBe(70000);
  });

  it("PM A cannot write performance to PM B's task (RLS → ok:false, no row)", async () => {
    const res = await upsertPerformanceBatch({ userId: pmA, role: "PM" }, { clientId: clientB, year: 2026, month: 3, rows: [{ taskId: taskB1, count: 1, amount: null }] });
    expect(res.ok).toBe(false);
    const rows = await listPerformance(ADMIN, clientB, 2026, 3);
    expect(rows).toHaveLength(0);
  });

  it("rejects a row whose task belongs to a different client", async () => {
    const res = await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2026, month: 3, rows: [{ taskId: taskB1, count: 1, amount: null }] });
    expect(res.ok).toBe(false);
  });

  it("year 기준: 조회 연도 1~12월 실적을 과업별로 합산한다", async () => {
    await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2026, month: 1, rows: [{ taskId: taskA1, count: 2, amount: null }] });
    await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2026, month: 2, rows: [{ taskId: taskA1, count: 3, amount: null }] });
    const totals = await listPerformanceTotals(ADMIN, clientA, { basis: "year", year: 2026 });
    expect(totals).toHaveLength(1);
    expect(totals[0]).toEqual({ taskId: taskA1, totalCount: 5, totalAmount: 50000 });
  });

  it("PM totals are RLS-scoped (no other client rows)", async () => {
    await upsertPerformanceBatch(ADMIN, { clientId: clientB, year: 2026, month: 1, rows: [{ taskId: taskB1, count: 4, amount: null }] });
    const totals = await listPerformanceTotals({ userId: pmA, role: "PM" }, clientB, { basis: "year", year: 2026 });
    expect(totals).toHaveLength(0);
  });

  it("year 기준은 조회 연도만, project 기준은 프로젝트 계약기간 전체를 합산한다", async () => {
    // 2026-06~2027-06 프로젝트에 과업 하나. 2026년 12월과 2027년 1월에 실적 입력.
    const proj = await createProject(ADMIN, clientA, {
      name: "2026~2027", contractStart: new Date("2026-06-01"), contractEnd: new Date("2027-06-30"), pmIds: [pmA],
    });
    const task = await createTask(ADMIN, { clientId: clientA, projectId: proj.id, name: "운영", unitPrice: 1000 });
    await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2026, month: 12, rows: [{ taskId: task.id, count: 5, amount: null }] });
    await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2027, month: 1, rows: [{ taskId: task.id, count: 3, amount: null }] });

    // 조회 월 2026-12 → 이 프로젝트가 대상.
    // year 기준(2026): 2026년치(12월 5회)만.
    const byYear = await listPerformanceTotals(ADMIN, clientA, { basis: "year", year: 2026 });
    expect(byYear.find((t) => t.taskId === task.id)).toEqual({ taskId: task.id, totalCount: 5, totalAmount: 5000 });
    // project 기준: 계약기간(2026-06~2027-06) 전체 → 2026-12(5) + 2027-01(3) = 8회.
    const byProject = await listPerformanceTotals(ADMIN, clientA, { basis: "project", year: 2026, month: 12 });
    expect(byProject.find((t) => t.taskId === task.id)).toEqual({ taskId: task.id, totalCount: 8, totalAmount: 8000 });
  });
});
