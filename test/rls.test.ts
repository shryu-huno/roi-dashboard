import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS } from "@/lib/rls";

// ADMIN 컨텍스트: 정책상 모든 행 접근 허용 → 시드/정리에 사용.
const ADMIN = { userId: "seed-admin", role: "ADMIN" as const };

async function reset() {
  await withRLS(ADMIN, async (tx) => {
    await tx.expense.deleteMany();
    await tx.monthlyDeposit.deleteMany();
    await tx.monthlyBilling.deleteMany();
    await tx.monthlyPerformance.deleteMany();
    await tx.task.deleteMany();
    await tx.client.deleteMany();
  });
  await prisma.user.deleteMany(); // User는 RLS 미적용
}

describe("RLS: PM sees only own clients", () => {
  let pmA: string;
  let pmB: string;
  let clientA: string;
  let clientB: string;
  let taskA: string;

  beforeEach(async () => {
    await reset();
    const a = await prisma.user.create({ data: { email: "pma@huno.kr", role: "PM", status: "ACTIVE" } });
    const b = await prisma.user.create({ data: { email: "pmb@huno.kr", role: "PM", status: "ACTIVE" } });
    pmA = a.id;
    pmB = b.id;
    await withRLS(ADMIN, async (tx) => {
      clientA = (await tx.client.create({ data: { name: "A사", pmId: pmA } })).id;
      clientB = (await tx.client.create({ data: { name: "B사", pmId: pmB } })).id;
      taskA = (await tx.task.create({ data: { clientId: clientA, name: "심리진단", unitPrice: 10000 } })).id;
      await tx.task.create({ data: { clientId: clientB, name: "전문가상담", unitPrice: 20000 } });
    });
  });

  it("PM A reads only client A", async () => {
    const rows = await withRLS({ userId: pmA, role: "PM" }, (tx) => tx.client.findMany());
    expect(rows.map((r) => r.id)).toEqual([clientA]);
  });

  it("PM A reads only tasks under client A (child-table policy)", async () => {
    const rows = await withRLS({ userId: pmA, role: "PM" }, (tx) => tx.task.findMany());
    expect(rows.map((r) => r.id)).toEqual([taskA]);
  });

  it("ADMIN reads all clients", async () => {
    const rows = await withRLS({ userId: pmA, role: "ADMIN" }, (tx) => tx.client.findMany());
    expect(rows.length).toBe(2);
  });

  it("PM A cannot update client B", async () => {
    const result = await withRLS({ userId: pmA, role: "PM" }, (tx) =>
      tx.client.updateMany({ where: { id: clientB }, data: { name: "해킹" } }),
    );
    expect(result.count).toBe(0);
  });

  it("PM A cannot create a client attributed to PM B (WITH CHECK)", async () => {
    await expect(
      withRLS({ userId: pmA, role: "PM" }, (tx) =>
        tx.client.create({ data: { name: "탈취시도", pmId: pmB } }),
      ),
    ).rejects.toThrow(/로우 단위 보안 정책|row-level security/i);
  });

  it("PM A cannot create a task under PM B's client (child-table WITH CHECK)", async () => {
    await expect(
      withRLS({ userId: pmA, role: "PM" }, (tx) =>
        tx.task.create({ data: { clientId: clientB, name: "탈취과업", unitPrice: 1000 } }),
      ),
    ).rejects.toThrow(/로우 단위 보안 정책|row-level security/i);
  });

  it("PM A CAN create a client for themselves (WITH CHECK positive control)", async () => {
    const created = await withRLS({ userId: pmA, role: "PM" }, (tx) =>
      tx.client.create({ data: { name: "본인고객사", pmId: pmA } }),
    );
    expect(created.pmId).toBe(pmA);
  });

  it("SETTLEMENT reads all clients", async () => {
    const rows = await withRLS({ userId: "settle", role: "SETTLEMENT" }, (tx) => tx.client.findMany());
    expect(rows.length).toBe(2);
  });
});
