import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS } from "@/lib/rls";
import { upsertExpense, listExpenses } from "@/lib/data/expenses";
import { createClient } from "@/lib/data/clients";

const ADMIN = { userId: "seed-admin", role: "ADMIN" as const };

async function reset() {
  await withRLS(ADMIN, async (tx) => {
    await tx.expense.deleteMany();
    await tx.client.deleteMany();
  });
  await prisma.user.deleteMany();
}

describe("expenses data layer", () => {
  let pmA: string, pmB: string, clientA: string, clientB: string;
  beforeEach(async () => {
    await reset();
    pmA = (await prisma.user.create({ data: { email: "pma@huno.kr", role: "PM", status: "ACTIVE" } })).id;
    pmB = (await prisma.user.create({ data: { email: "pmb@huno.kr", role: "PM", status: "ACTIVE" } })).id;
    clientA = (await createClient(ADMIN, { name: "A사", pmId: pmA })).id;
    clientB = (await createClient(ADMIN, { name: "B사", pmId: pmB })).id;
  });

  it("upserts one row per category and updates in place", async () => {
    await upsertExpense(ADMIN, { clientId: clientA, year: 2026, month: 3, category: "OPS_FOOD", amount: 5000, memo: "회식" });
    await upsertExpense(ADMIN, { clientId: clientA, year: 2026, month: 3, category: "OPS_FOOD", amount: 7000, memo: "정정" });
    const rows = await listExpenses(ADMIN, clientA, 2026, 3);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(7000);
    expect(rows[0].memo).toBe("정정");
  });

  it("keeps different categories as separate rows", async () => {
    await upsertExpense(ADMIN, { clientId: clientA, year: 2026, month: 3, category: "OPS_FOOD", amount: 5000 });
    await upsertExpense(ADMIN, { clientId: clientA, year: 2026, month: 3, category: "OPS_TRANSPORT", amount: 3000 });
    const rows = await listExpenses(ADMIN, clientA, 2026, 3);
    expect(rows).toHaveLength(2);
  });

  it("PM A cannot read/write PM B's expenses (RLS)", async () => {
    await upsertExpense(ADMIN, { clientId: clientB, year: 2026, month: 3, category: "OPS_FOOD", amount: 5000 });
    const rowsForA = await listExpenses({ userId: pmA, role: "PM" }, clientB, 2026, 3);
    expect(rowsForA).toHaveLength(0);
  });
});
