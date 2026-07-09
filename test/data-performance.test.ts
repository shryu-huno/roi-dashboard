import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS } from "@/lib/rls";
import { upsertPerformanceBatch, listPerformance } from "@/lib/data/performance";
import { createClient } from "@/lib/data/clients";
import { createTask } from "@/lib/data/tasks";

const ADMIN = { userId: "seed-admin", role: "ADMIN" as const };

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
    clientA = (await createClient(ADMIN, { name: "A사", pmId: pmA })).id;
    taskA1 = (await createTask(ADMIN, { clientId: clientA, name: "심리진단", unitPrice: 10000 })).id;
    clientB = (await createClient(ADMIN, { name: "B사", pmId: pmB })).id;
    taskB1 = (await createTask(ADMIN, { clientId: clientB, name: "상담", unitPrice: 20000 })).id;
  });

  it("computes amount = unitPrice * count on save", async () => {
    const res = await upsertPerformanceBatch({ userId: pmA, role: "PM" }, { clientId: clientA, year: 2026, month: 3, rows: [{ taskId: taskA1, count: 4 }] });
    expect(res.ok).toBe(true);
    const rows = await listPerformance(ADMIN, clientA, 2026, 3);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(40000);
    expect(rows[0].count).toBe(4);
  });

  it("upsert is idempotent on (task, year, month)", async () => {
    await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2026, month: 3, rows: [{ taskId: taskA1, count: 4 }] });
    await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2026, month: 3, rows: [{ taskId: taskA1, count: 7 }] });
    const rows = await listPerformance(ADMIN, clientA, 2026, 3);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(7);
    expect(rows[0].amount).toBe(70000);
  });

  it("PM A cannot write performance to PM B's task (RLS → ok:false, no row)", async () => {
    const res = await upsertPerformanceBatch({ userId: pmA, role: "PM" }, { clientId: clientB, year: 2026, month: 3, rows: [{ taskId: taskB1, count: 1 }] });
    expect(res.ok).toBe(false);
    const rows = await listPerformance(ADMIN, clientB, 2026, 3);
    expect(rows).toHaveLength(0);
  });

  it("rejects a row whose task belongs to a different client", async () => {
    const res = await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2026, month: 3, rows: [{ taskId: taskB1, count: 1 }] });
    expect(res.ok).toBe(false);
  });
});
