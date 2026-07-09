import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS } from "@/lib/rls";
import { listClients, createClient, updateClient } from "@/lib/data/clients";

const ADMIN = { userId: "seed-admin", role: "ADMIN" as const };

async function reset() {
  await withRLS(ADMIN, async (tx) => {
    await tx.task.deleteMany();
    await tx.client.deleteMany();
  });
  await prisma.user.deleteMany();
}

describe("clients data layer", () => {
  let pmA: string, pmB: string;
  beforeEach(async () => {
    await reset();
    pmA = (await prisma.user.create({ data: { email: "pma@huno.kr", role: "PM", status: "ACTIVE" } })).id;
    pmB = (await prisma.user.create({ data: { email: "pmb@huno.kr", role: "PM", status: "ACTIVE" } })).id;
  });

  it("ADMIN creates and lists clients", async () => {
    await createClient(ADMIN, { name: "A사", pmId: pmA });
    await createClient(ADMIN, { name: "B사", pmId: pmB });
    const rows = await listClients(ADMIN);
    expect(rows.map((r) => r.name)).toEqual(["A사", "B사"]);
  });

  it("PM sees only own client (RLS)", async () => {
    await createClient(ADMIN, { name: "A사", pmId: pmA });
    await createClient(ADMIN, { name: "B사", pmId: pmB });
    const rows = await listClients({ userId: pmA, role: "PM" });
    expect(rows.map((r) => r.name)).toEqual(["A사"]);
  });

  it("PM cannot update another PM's client (RLS → ok:false)", async () => {
    const b = await createClient(ADMIN, { name: "B사", pmId: pmB });
    const res = await updateClient({ userId: pmA, role: "PM" }, b.id, { name: "해킹", pmId: pmB });
    expect(res.ok).toBe(false);
    const still = await withRLS(ADMIN, (tx) => tx.client.findUnique({ where: { id: b.id } }));
    expect(still?.name).toBe("B사");
  });
});
