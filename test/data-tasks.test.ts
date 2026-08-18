import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS } from "@/lib/rls";
import { listTasks, updateTask, deleteTask, createTask } from "@/lib/data/tasks";
import { createProject } from "@/lib/data/projects";
import { mkClient, mkTask } from "./factories";

const ADMIN = { userId: "seed-admin", role: "SUPER_ADMIN" as const };

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
    clientA = (await mkClient(ADMIN, { name: "A사", pmIds: [pmA] })).id;
    clientB = (await mkClient(ADMIN, { name: "B사", pmIds: [pmB] })).id;
  });

  it("creates a task with MANUAL source and null contract when count omitted", async () => {
    const t = await mkTask(ADMIN, { clientId: clientA, name: "심리진단", unitPrice: 10000, contractCount: null });
    expect(t.source).toBe("MANUAL");
    expect(t.contractCount).toBeNull();
    expect(t.contractAmount).toBeNull();
    const rows = await listTasks(ADMIN, clientA);
    expect(rows.map((r) => r.name)).toEqual(["심리진단"]);
  });

  it("derives contractAmount = unitPrice * contractCount", async () => {
    const t = await mkTask(ADMIN, { clientId: clientA, name: "심리진단", unitPrice: 10000, contractCount: 12 });
    expect(t.contractCount).toBe(12);
    expect(t.contractAmount).toBe(120000);
  });

  it("recomputes contractAmount on update when unit price changes", async () => {
    const t = await mkTask(ADMIN, { clientId: clientA, name: "심리진단", unitPrice: 10000, contractCount: 5 });
    await updateTask(ADMIN, t.id, { name: "심리진단", unitPrice: 12000, contractCount: 5 });
    const rows = await listTasks(ADMIN, clientA);
    expect(rows[0].contractAmount).toBe(60000);
  });

  it("stores a manual contractAmount override instead of unitPrice × count", async () => {
    const t = await mkTask(ADMIN, { clientId: clientA, name: "심리진단", unitPrice: 10000, contractCount: 50, contractAmount: 480000 });
    expect(t.contractAmount).toBe(480000); // 자동값 500000 대신 수동값
    expect(t.contractCount).toBe(50);
  });

  it("updates a manual contractAmount override", async () => {
    const t = await mkTask(ADMIN, { clientId: clientA, name: "심리진단", unitPrice: 10000, contractCount: 50 });
    await updateTask(ADMIN, t.id, {name: "심리진단", unitPrice: 10000, contractCount: 50, contractAmount: 480000 });
    const rows = await listTasks(ADMIN, clientA);
    expect(rows[0].contractAmount).toBe(480000);
  });

  it("falls back to unitPrice × count when contractAmount is omitted", async () => {
    const t = await mkTask(ADMIN, { clientId: clientA, name: "심리진단", unitPrice: 10000, contractCount: 50 });
    expect(t.contractAmount).toBe(500000);
  });

  it("PM lists only own client's tasks (RLS)", async () => {
    await mkTask(ADMIN, { clientId: clientA, name: "심리진단", unitPrice: 10000 });
    await mkTask(ADMIN, { clientId: clientB, name: "상담", unitPrice: 20000 });
    const rows = await listTasks({ userId: pmA, role: "PM" }, clientA);
    expect(rows.map((r) => r.name)).toEqual(["심리진단"]);
  });

  it("PM cannot delete a task under another PM's client (RLS → ok:false)", async () => {
    const t = await mkTask(ADMIN, { clientId: clientB, name: "상담", unitPrice: 20000 });
    const res = await deleteTask({ userId: pmA, role: "PM" }, t.id);
    expect(res.ok).toBe(false);
    const still = await withRLS(ADMIN, (tx) => tx.task.findUnique({ where: { id: t.id } }));
    expect(still).not.toBeNull();
  });

  it("updates a task's unit price", async () => {
    const t = await mkTask(ADMIN, { clientId: clientA, name: "심리진단", unitPrice: 10000 });
    const res = await updateTask(ADMIN, t.id, {name: "심리진단", unitPrice: 12000 });
    expect(res.ok).toBe(true);
    const rows = await listTasks(ADMIN, clientA);
    expect(rows[0].unitPrice).toBe(12000);
  });

  it("period 지정 시 조회 월을 계약기간에 포함하는 프로젝트의 과업만 반환한다", async () => {
    // A사에 기간이 다른 두 프로젝트. 기본 프로젝트(mkClient)는 날짜 없음 → 항상 포함.
    const past = await createProject(ADMIN, clientA, {
      name: "2025~2026", contractStart: new Date("2025-06-01"), contractEnd: new Date("2026-05-31"), pmIds: [pmA],
    });
    const curr = await createProject(ADMIN, clientA, {
      name: "2026~2027", contractStart: new Date("2026-06-01"), contractEnd: new Date("2027-06-30"), pmIds: [pmA],
    });
    await createTask(ADMIN, { clientId: clientA, projectId: past.id, name: "과거과업", unitPrice: 1000 });
    await createTask(ADMIN, { clientId: clientA, projectId: curr.id, name: "현재과업", unitPrice: 1000 });

    // 2026년 6월: 현재 프로젝트만 포함(과거 프로젝트는 2026-05-31 종료로 제외). 날짜 없는 기본 프로젝트는 포함.
    const jun = await listTasks(ADMIN, clientA, { year: 2026, month: 6 });
    expect(jun.map((r) => r.name).sort()).toEqual(["현재과업"]);
    // 2026년 3월: 과거 프로젝트만 포함(현재 프로젝트는 2026-06-01 시작으로 제외).
    const mar = await listTasks(ADMIN, clientA, { year: 2026, month: 3 });
    expect(mar.map((r) => r.name).sort()).toEqual(["과거과업"]);
    // period 미전달이면 전체 반환.
    const all = await listTasks(ADMIN, clientA);
    expect(all.map((r) => r.name).sort()).toEqual(["과거과업", "현재과업"]);
  });
});
