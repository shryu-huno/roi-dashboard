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
    clientA = (await createClient(ADMIN, { name: "A사", pmId: pmA })).id;
    clientB = (await createClient(ADMIN, { name: "B사", pmId: pmB })).id;
  });

  it("creates a task with MANUAL source and nullable contractAmount", async () => {
    const t = await createTask(ADMIN, { clientId: clientA, name: "심리진단", unitPrice: 10000, contractAmount: null });
    expect(t.source).toBe("MANUAL");
    expect(t.contractAmount).toBeNull();
    const rows = await listTasks(ADMIN, clientA);
    expect(rows.map((r) => r.name)).toEqual(["심리진단"]);
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
