import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS } from "@/lib/rls";

// 전체 열람(SUPER_ADMIN) 컨텍스트: 정책상 모든 행 접근 허용 → 시드/정리에 사용.
const ROOT = { userId: "seed-admin", role: "SUPER_ADMIN" as const };

async function reset() {
  await withRLS(ROOT, async (tx) => {
    await tx.expense.deleteMany();
    await tx.monthlyDeposit.deleteMany();
    await tx.monthlyBilling.deleteMany();
    await tx.monthlyPerformance.deleteMany();
    await tx.task.deleteMany();
    await tx.client.deleteMany();
    await tx.team.deleteMany();
  });
  await prisma.user.deleteMany(); // User는 RLS 미적용
}

describe("RLS: PM sees only own clients", () => {
  let pmA: string;
  let pmB: string;
  let clientA: string;
  let clientB: string;
  let projectA: string;
  let projectB: string;
  let taskA: string;
  let teamT1: string;
  let teamT2: string;
  let adminT1: string;

  beforeEach(async () => {
    await reset();
    const a = await prisma.user.create({ data: { email: "pma@huno.kr", role: "PM", status: "ACTIVE" } });
    const b = await prisma.user.create({ data: { email: "pmb@huno.kr", role: "PM", status: "ACTIVE" } });
    pmA = a.id;
    pmB = b.id;
    await withRLS(ROOT, async (tx) => {
      teamT1 = (await tx.team.create({ data: { name: "T1" } })).id;
      teamT2 = (await tx.team.create({ data: { name: "T2" } })).id;
      // 접근 권한(RLS)은 ClientManager 기준을 유지한다. 프로젝트에도 담당 PM(ProjectManager)을 둔다.
      clientA = (await tx.client.create({ data: { name: "A사", managers: { create: [{ userId: pmA }] } } })).id;
      clientB = (await tx.client.create({ data: { name: "B사", managers: { create: [{ userId: pmB }] } } })).id;
      projectA = (await tx.project.create({ data: { clientId: clientA, name: "P-A", managers: { create: [{ userId: pmA }] } } })).id;
      projectB = (await tx.project.create({ data: { clientId: clientB, name: "P-B", managers: { create: [{ userId: pmB }] } } })).id;
      taskA = (await tx.task.create({ data: { clientId: clientA, projectId: projectA, name: "심리진단", unitPrice: 10000 } })).id;
      await tx.task.create({ data: { clientId: clientB, projectId: projectB, name: "전문가상담", unitPrice: 20000 } });
    });
    // PM들을 팀에 배정하고(고객사의 팀 귀속을 담당 PM에서 도출), T1 팀 관리자를 만든다.
    await prisma.user.update({ where: { id: pmA }, data: { teamId: teamT1 } });
    await prisma.user.update({ where: { id: pmB }, data: { teamId: teamT2 } });
    adminT1 = (await prisma.user.create({ data: { email: "admt1@huno.kr", role: "ADMIN", status: "ACTIVE", teamId: teamT1 } })).id;
  });

  it("PM A reads only client A", async () => {
    const rows = await withRLS({ userId: pmA, role: "PM" }, (tx) => tx.client.findMany());
    expect(rows.map((r) => r.id)).toEqual([clientA]);
  });

  it("PM A reads only tasks under client A (child-table policy)", async () => {
    const rows = await withRLS({ userId: pmA, role: "PM" }, (tx) => tx.task.findMany());
    expect(rows.map((r) => r.id)).toEqual([taskA]);
  });

  it("PM A reads only projects under client A (Project policy via ClientManager)", async () => {
    const rows = await withRLS({ userId: pmA, role: "PM" }, (tx) => tx.project.findMany());
    expect(rows.map((r) => r.id)).toEqual([projectA]);
  });

  it("PM A cannot create a project under PM B's client (Project WITH CHECK)", async () => {
    await expect(
      withRLS({ userId: pmA, role: "PM" }, (tx) =>
        tx.project.create({ data: { clientId: clientB, name: "탈취프로젝트" } }),
      ),
    ).rejects.toThrow(/로우 단위 보안 정책|row-level security/i);
  });

  it("PM A cannot assign a project manager on PM B's project (ProjectManager WITH CHECK)", async () => {
    await expect(
      withRLS({ userId: pmA, role: "PM" }, (tx) =>
        tx.projectManager.create({ data: { projectId: projectB, userId: pmA } }),
      ),
    ).rejects.toThrow(/로우 단위 보안 정책|row-level security/i);
  });

  it("SUPER_ADMIN reads all clients", async () => {
    const rows = await withRLS({ userId: pmA, role: "SUPER_ADMIN" }, (tx) => tx.client.findMany());
    expect(rows.length).toBe(2);
  });

  it("team ADMIN reads only own team's clients (T1 → client A only)", async () => {
    const rows = await withRLS({ userId: adminT1, role: "ADMIN", teamId: teamT1 }, (tx) => tx.client.findMany());
    expect(rows.map((r) => r.id)).toEqual([clientA]);
  });

  it("team ADMIN cannot see another team's client (T1 admin ↛ client B)", async () => {
    const rows = await withRLS({ userId: adminT1, role: "ADMIN", teamId: teamT1 }, (tx) =>
      tx.client.findMany({ where: { id: clientB } }),
    );
    expect(rows.length).toBe(0);
  });

  it("team ADMIN reads only own team's tasks and performance (child tables)", async () => {
    const tasks = await withRLS({ userId: adminT1, role: "ADMIN", teamId: teamT1 }, (tx) => tx.task.findMany());
    expect(tasks.map((r) => r.id)).toEqual([taskA]);
  });

  it("team ADMIN with no team sees nothing", async () => {
    const rows = await withRLS({ userId: adminT1, role: "ADMIN", teamId: null }, (tx) => tx.client.findMany());
    expect(rows.length).toBe(0);
  });

  it("PM A cannot update client B", async () => {
    const result = await withRLS({ userId: pmA, role: "PM" }, (tx) =>
      tx.client.updateMany({ where: { id: clientB }, data: { name: "해킹" } }),
    );
    expect(result.count).toBe(0);
  });

  it("PM cannot create a client (WITH CHECK: 담당 멤버십 없음)", async () => {
    // N:M 모델에선 Client INSERT 시점에 담당 멤버십이 없어 PM은 고객사를 생성할 수 없다
    // (고객사 생성은 앱상 SETTLEMENT/ADMIN 전용).
    await expect(
      withRLS({ userId: pmA, role: "PM" }, (tx) =>
        tx.client.create({ data: { name: "탈취시도" } }),
      ),
    ).rejects.toThrow(/로우 단위 보안 정책|row-level security/i);
  });

  it("PM A cannot create a task under PM B's client (child-table WITH CHECK)", async () => {
    await expect(
      withRLS({ userId: pmA, role: "PM" }, (tx) =>
        tx.task.create({ data: { clientId: clientB, projectId: projectB, name: "탈취과업", unitPrice: 1000 } }),
      ),
    ).rejects.toThrow(/로우 단위 보안 정책|row-level security/i);
  });

  it("PM A CAN update their own managed client (USING/WITH CHECK positive control)", async () => {
    const result = await withRLS({ userId: pmA, role: "PM" }, (tx) =>
      tx.client.updateMany({ where: { id: clientA }, data: { status: "보류" } }),
    );
    expect(result.count).toBe(1);
  });

  it("PM cannot self-assign as a manager (ClientManager WITH CHECK)", async () => {
    await expect(
      withRLS({ userId: pmA, role: "PM" }, (tx) =>
        tx.clientManager.create({ data: { clientId: clientB, userId: pmA } }),
      ),
    ).rejects.toThrow(/로우 단위 보안 정책|row-level security/i);
  });

  it("SETTLEMENT reads all clients", async () => {
    const rows = await withRLS({ userId: "settle", role: "SETTLEMENT" }, (tx) => tx.client.findMany());
    expect(rows.length).toBe(2);
  });
});
