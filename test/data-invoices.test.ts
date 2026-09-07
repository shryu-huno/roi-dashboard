import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS } from "@/lib/rls";
import { listInvoices, createInvoice, updateInvoice, deleteInvoice, markInvoicePaid } from "@/lib/data/invoices";
import { mkClient } from "./factories";

const ADMIN = { userId: "seed-admin", role: "SUPER_ADMIN" as const };

async function reset() {
  await withRLS(ADMIN, async (tx) => {
    await tx.invoice.deleteMany();
    await tx.client.deleteMany();
  });
  await prisma.user.deleteMany();
}

describe("invoices data layer", () => {
  let pmA: string, pmB: string, clientA: string, clientB: string;
  beforeEach(async () => {
    await reset();
    pmA = (await prisma.user.create({ data: { email: "pma@huno.kr", name: "PM A", role: "PM", status: "ACTIVE" } })).id;
    pmB = (await prisma.user.create({ data: { email: "pmb@huno.kr", name: "PM B", role: "PM", status: "ACTIVE" } })).id;
    clientA = (await mkClient(ADMIN, { name: "A사", pmIds: [pmA] })).id;
    clientB = (await mkClient(ADMIN, { name: "B사", pmIds: [pmB] })).id;
    await withRLS(ADMIN, (tx) => tx.client.update({ where: { id: clientA }, data: { businessType: "휴노" } }));
  });

  it("createInvoice + listInvoices returns an enriched row (client·사업자구분·담당PM)", async () => {
    await createInvoice(ADMIN, { clientId: clientA, amount: 33000, issueDate: new Date("2026-03-10"), note: "3월분" });
    const rows = await listInvoices(ADMIN);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      clientName: "A사",
      businessType: "휴노",
      pmLabel: "PM A",
      amount: 33000,
      note: "3월분",
      paidDate: null,
    });
  });

  it("markInvoicePaid records the deposit date", async () => {
    await createInvoice(ADMIN, { clientId: clientA, amount: 10000, issueDate: new Date("2026-03-10") });
    const id = (await listInvoices(ADMIN))[0].id;
    const res = await markInvoicePaid(ADMIN, id, new Date("2026-04-01"));
    expect(res.ok).toBe(true);
    const row = (await listInvoices(ADMIN))[0];
    expect(row.paidDate?.toISOString().slice(0, 10)).toBe("2026-04-01");
  });

  it("updateInvoice changes amount/note in place", async () => {
    await createInvoice(ADMIN, { clientId: clientA, amount: 10000, issueDate: new Date("2026-03-10"), note: "old" });
    const id = (await listInvoices(ADMIN))[0].id;
    await updateInvoice(ADMIN, id, { clientId: clientA, amount: 44000, issueDate: new Date("2026-03-10"), note: "new" });
    const row = (await listInvoices(ADMIN))[0];
    expect(row).toMatchObject({ amount: 44000, note: "new" });
  });

  it("deleteInvoice removes the row", async () => {
    await createInvoice(ADMIN, { clientId: clientA, amount: 10000, issueDate: new Date("2026-03-10") });
    const id = (await listInvoices(ADMIN))[0].id;
    await deleteInvoice(ADMIN, id);
    expect(await listInvoices(ADMIN)).toHaveLength(0);
  });

  it("PM A cannot see PM B's invoice (RLS)", async () => {
    await createInvoice(ADMIN, { clientId: clientB, amount: 9000, issueDate: new Date("2026-03-10") });
    const rows = await listInvoices({ userId: pmA, role: "PM" });
    expect(rows).toHaveLength(0);
  });

  it("PM A cannot create an invoice on PM B's client (WITH CHECK → ok:false)", async () => {
    const res = await createInvoice({ userId: pmA, role: "PM" }, { clientId: clientB, amount: 1000, issueDate: new Date("2026-03-10") });
    expect(res.ok).toBe(false);
    expect(await listInvoices(ADMIN)).toHaveLength(0);
  });
});
