import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS } from "@/lib/rls";
import { createProject } from "@/lib/data/projects";

// 전체 열람(SUPER_ADMIN) 컨텍스트: 정책상 모든 행 접근 허용 → 시드/정리에 사용.
const ROOT = { userId: "seed-admin", role: "SUPER_ADMIN" as const };

async function reset() {
  await withRLS(ROOT, async (tx) => {
    await tx.expense.deleteMany();
    await tx.invoice.deleteMany();
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
  let leaderL: string;

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
    // 파트장 L: pmA를 자기 소속(partLeaderId)으로 둔다. pmB는 소속이 아니다.
    leaderL = (await prisma.user.create({ data: { email: "leadl@huno.kr", role: "PART_LEADER", status: "ACTIVE", teamId: teamT1 } })).id;
    await prisma.user.update({ where: { id: pmA }, data: { partLeaderId: leaderL } });
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

  it("PM A reads only invoices under client A (Invoice policy via app_can_see_client)", async () => {
    await withRLS(ROOT, (tx) =>
      tx.invoice.createMany({
        data: [
          { clientId: clientA, amount: 11000, issueDate: new Date("2026-03-01") },
          { clientId: clientB, amount: 22000, issueDate: new Date("2026-03-01") },
        ],
      }),
    );
    const rows = await withRLS({ userId: pmA, role: "PM" }, (tx) => tx.invoice.findMany());
    expect(rows.map((r) => r.clientId)).toEqual([clientA]);
  });

  it("PM A cannot create an invoice under PM B's client (Invoice WITH CHECK)", async () => {
    await expect(
      withRLS({ userId: pmA, role: "PM" }, (tx) =>
        tx.invoice.create({ data: { clientId: clientB, amount: 1000, issueDate: new Date("2026-03-01") } }),
      ),
    ).rejects.toThrow(/로우 단위 보안 정책|row-level security/i);
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

  it("PM-created project inherits the client's manager (self) as ProjectManager", async () => {
    const proj = await createProject({ userId: pmA, role: "PM" }, clientA, { name: "PM 생성 프로젝트" });
    const rows = await withRLS(ROOT, (tx) => tx.projectManager.findMany({ where: { projectId: proj.id } }));
    expect(rows.map((r) => r.userId)).toEqual([pmA]);
  });

  it("PM-created project inherits ALL client managers, incl. co-PMs the creator can't see", async () => {
    // 공동 담당 PM 구성: clientA에 pmA·pmB를 함께 배정(관리자 컨텍스트로 세팅).
    await withRLS(ROOT, (tx) => tx.clientManager.create({ data: { clientId: clientA, userId: pmB } }));
    // 생성자 pmA는 RLS상 pmB의 ClientManager 행을 볼 수 없지만, 승계 결과엔 둘 다 포함돼야 한다.
    const proj = await createProject({ userId: pmA, role: "PM" }, clientA, { name: "공동 PM 프로젝트" });
    const rows = await withRLS(ROOT, (tx) => tx.projectManager.findMany({ where: { projectId: proj.id } }));
    expect(rows.map((r) => r.userId).sort()).toEqual([pmA, pmB].sort());
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

  it("part leader reads only their member PM's clients (L→pmA ⇒ client A only)", async () => {
    const rows = await withRLS({ userId: leaderL, role: "PART_LEADER" }, (tx) => tx.client.findMany());
    expect(rows.map((r) => r.id)).toEqual([clientA]);
  });

  it("part leader cannot see a non-member PM's client (L ↛ client B)", async () => {
    const rows = await withRLS({ userId: leaderL, role: "PART_LEADER" }, (tx) =>
      tx.client.findMany({ where: { id: clientB } }),
    );
    expect(rows.length).toBe(0);
  });

  it("part leader CAN update their member's client (USING/WITH CHECK positive control)", async () => {
    const result = await withRLS({ userId: leaderL, role: "PART_LEADER" }, (tx) =>
      tx.client.updateMany({ where: { id: clientA }, data: { status: "보류" } }),
    );
    expect(result.count).toBe(1);
  });

  it("part leader can assign their member PM as a manager (ClientManager WITH CHECK)", async () => {
    const pmA2 = (await prisma.user.create({
      data: { email: "pma2@huno.kr", role: "PM", status: "ACTIVE", teamId: teamT1, partLeaderId: leaderL },
    })).id;
    await withRLS({ userId: leaderL, role: "PART_LEADER" }, (tx) =>
      tx.clientManager.create({ data: { clientId: clientA, userId: pmA2 } }),
    );
    const rows = await withRLS(ROOT, (tx) => tx.clientManager.findMany({ where: { clientId: clientA } }));
    expect(rows.map((r) => r.userId)).toContain(pmA2);
  });

  it("part leader cannot assign a non-member PM (pmB) as a manager (WITH CHECK)", async () => {
    await expect(
      withRLS({ userId: leaderL, role: "PART_LEADER" }, (tx) =>
        tx.clientManager.create({ data: { clientId: clientA, userId: pmB } }),
      ),
    ).rejects.toThrow(/로우 단위 보안 정책|row-level security/i);
  });
});
