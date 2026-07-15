import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS } from "@/lib/rls";
import { listTasks, createTask, updateTask, deleteTask } from "@/lib/data/tasks";
import { createClient } from "@/lib/data/clients";

const ADMIN = { userId: "seed-admin", role: "ADMIN" as const };

async function reset() {
  await withRLS(ADMIN, async (tx) => {
    await tx.monthlyPerformance.deleteMany();
    await tx.task.deleteMany();
    await tx.client.deleteMany();
  });
  await prisma.user.deleteMany();
}

describe("tasks data layer", () => {
  let pmA: string, pmB: string, clientA: string, clientB: string;
  beforeEach(async () => {
    await reset();
    pmA = (await prisma.user.create({ data: { email: "pma@huno.kr", role: "PM", status: "ACTIVE" } })).id;
    pmB = (await prisma.user.create({ data: { email: "pmb@huno.kr", role: "PM", status: "ACTIVE" } })).id;
    clientA = (await createClient(ADMIN, { name: "A사", pmIds: [pmA] })).id;
    clientB = (await createClient(ADMIN, { name: "B사", pmIds: [pmB] })).id;
  });

  it("creates a task with MANUAL source and null contract when count omitted", async () => {
    const t = await createTask(ADMIN, { clientId: clientA, name: "심리진단", unitPrice: 10000, contractCount: null });
    expect(t.source).toBe("MANUAL");
    expect(t.contractCount).toBeNull();
    expect(t.contractAmount).toBeNull();
    const rows = await listTasks(ADMIN, clientA);
    expect(rows.map((r) => r.name)).toEqual(["심리진단"]);
  });

  it("derives contractAmount = unitPrice * contractCount", async () => {
    const t = await createTask(ADMIN, { clientId: clientA, name: "심리진단", unitPrice: 10000, contractCount: 12 });
    expect(t.contractCount).toBe(12);
    expect(t.contractAmount).toBe(120000);
  });

  it("recomputes contractAmount on update when unit price changes", async () => {
    const t = await createTask(ADMIN, { clientId: clientA, name: "심리진단", unitPrice: 10000, contractCount: 5 });
    await updateTask(ADMIN, t.id, { clientId: clientA, name: "심리진단", unitPrice: 12000, contractCount: 5 });
    const rows = await listTasks(ADMIN, clientA);
    expect(rows[0].contractAmount).toBe(60000);
  });

  it("stores a manual contractAmount override instead of unitPrice × count", async () => {
    const t = await createTask(ADMIN, { clientId: clientA, name: "심리진단", unitPrice: 10000, contractCount: 50, contractAmount: 480000 });
    expect(t.contractAmount).toBe(480000); // 자동값 500000 대신 수동값
    expect(t.contractCount).toBe(50);
  });

  it("updates a manual contractAmount override", async () => {
    const t = await createTask(ADMIN, { clientId: clientA, name: "심리진단", unitPrice: 10000, contractCount: 50 });
    await updateTask(ADMIN, t.id, { clientId: clientA, name: "심리진단", unitPrice: 10000, contractCount: 50, contractAmount: 480000 });
    const rows = await listTasks(ADMIN, clientA);
    expect(rows[0].contractAmount).toBe(480000);
  });

  it("falls back to unitPrice × count when contractAmount is omitted", async () => {
    const t = await createTask(ADMIN, { clientId: clientA, name: "심리진단", unitPrice: 10000, contractCount: 50 });
    expect(t.contractAmount).toBe(500000);
  });

  it("PM lists only own client's tasks (RLS)", async () => {
    await createTask(ADMIN, { clientId: clientA, name: "심리진단", unitPrice: 10000 });
    await createTask(ADMIN, { clientId: clientB, name: "상담", unitPrice: 20000 });
    const rows = await listTasks({ userId: pmA, role: "PM" }, clientA);
    expect(rows.map((r) => r.name)).toEqual(["심리진단"]);
  });

  it("PM cannot delete a task under another PM's client (RLS → ok:false)", async () => {
    const t = await createTask(ADMIN, { clientId: clientB, name: "상담", unitPrice: 20000 });
    const res = await deleteTask({ userId: pmA, role: "PM" }, t.id);
    expect(res.ok).toBe(false);
    const still = await withRLS(ADMIN, (tx) => tx.task.findUnique({ where: { id: t.id } }));
    expect(still).not.toBeNull();
  });

  it("updates a task's unit price", async () => {
    const t = await createTask(ADMIN, { clientId: clientA, name: "심리진단", unitPrice: 10000 });
    const res = await updateTask(ADMIN, t.id, { clientId: clientA, name: "심리진단", unitPrice: 12000 });
    expect(res.ok).toBe(true);
    const rows = await listTasks(ADMIN, clientA);
    expect(rows[0].unitPrice).toBe(12000);
  });
});
