import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS } from "@/lib/rls";
import { upsertBilling, getBilling, upsertDeposit, getDeposit } from "@/lib/data/billing";
import { createClient } from "@/lib/data/clients";

const ADMIN = { userId: "seed-admin", role: "ADMIN" as const };

async function reset() {
  await withRLS(ADMIN, async (tx) => {
    await tx.monthlyBilling.deleteMany();
    await tx.monthlyDeposit.deleteMany();
    await tx.client.deleteMany();
  });
  await prisma.user.deleteMany();
}

describe("billing/deposit data layer", () => {
  let pmA: string, pmB: string, clientA: string, clientB: string;
  beforeEach(async () => {
    await reset();
    pmA = (await prisma.user.create({ data: { email: "pma@huno.kr", role: "PM", status: "ACTIVE" } })).id;
    pmB = (await prisma.user.create({ data: { email: "pmb@huno.kr", role: "PM", status: "ACTIVE" } })).id;
    clientA = (await createClient(ADMIN, { name: "A사", pmIds: [pmA] })).id;
    clientB = (await createClient(ADMIN, { name: "B사", pmIds: [pmB] })).id;
  });

  it("stores 0 as 0 (0원)", async () => {
    await upsertBilling(ADMIN, { clientId: clientA, year: 2026, month: 3, amount: 0 });
    const row = await getBilling(ADMIN, clientA, 2026, 3);
    expect(row?.amount).toBe(0);
  });

  it("null amount removes the row (미입력)", async () => {
    await upsertBilling(ADMIN, { clientId: clientA, year: 2026, month: 3, amount: 5000 });
    await upsertBilling(ADMIN, { clientId: clientA, year: 2026, month: 3, amount: null });
    const row = await getBilling(ADMIN, clientA, 2026, 3);
    expect(row).toBeNull();
  });

  it("upsert updates in place", async () => {
    await upsertDeposit(ADMIN, { clientId: clientA, year: 2026, month: 3, amount: 1000 });
    await upsertDeposit(ADMIN, { clientId: clientA, year: 2026, month: 3, amount: 2000 });
    const row = await getDeposit(ADMIN, clientA, 2026, 3);
    expect(row?.amount).toBe(2000);
  });

  it("PM A cannot read PM B's billing (RLS)", async () => {
    await upsertBilling(ADMIN, { clientId: clientB, year: 2026, month: 3, amount: 9000 });
    const row = await getBilling({ userId: pmA, role: "PM" }, clientB, 2026, 3);
    expect(row).toBeNull();
  });
});
