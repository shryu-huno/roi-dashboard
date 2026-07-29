import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS } from "@/lib/rls";
import { listClients, getClient, createClient, updateClient, archiveClient, restoreClient, listArchivedClients, setClientEasywel } from "@/lib/data/clients";
import { createTask } from "@/lib/data/tasks";

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
    await createClient(ADMIN, { name: "A사", pmIds: [pmA] });
    await createClient(ADMIN, { name: "B사", pmIds: [pmB] });
    const rows = await listClients(ADMIN);
    expect(rows.map((r) => r.name)).toEqual(["A사", "B사"]);
  });

  it("PM sees only own client (RLS)", async () => {
    await createClient(ADMIN, { name: "A사", pmIds: [pmA] });
    await createClient(ADMIN, { name: "B사", pmIds: [pmB] });
    const rows = await listClients({ userId: pmA, role: "PM" });
    expect(rows.map((r) => r.name)).toEqual(["A사"]);
  });

  it("PM cannot update another PM's client (RLS → ok:false)", async () => {
    const b = await createClient(ADMIN, { name: "B사", pmIds: [pmB] });
    const res = await updateClient({ userId: pmA, role: "PM" }, b.id, { name: "해킹", pmIds: [pmB] });
    expect(res.ok).toBe(false);
    const still = await withRLS(ADMIN, (tx) => tx.client.findUnique({ where: { id: b.id } }));
    expect(still?.name).toBe("B사");
  });

  it("getClient returns the client by id for ADMIN", async () => {
    const c = await createClient(ADMIN, { name: "A사", pmIds: [pmA] });
    const found = await getClient(ADMIN, c.id);
    expect(found?.name).toBe("A사");
  });

  it("PM cannot getClient another PM's client (RLS → null)", async () => {
    const b = await createClient(ADMIN, { name: "B사", pmIds: [pmB] });
    const found = await getClient({ userId: pmA, role: "PM" }, b.id);
    expect(found).toBeNull();
  });

  it("updateClient patches only provided fields, preserving unset ones", async () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const c = await createClient(ADMIN, { name: "A사", pmIds: [pmA], contractStart: start });
    const res = await updateClient(ADMIN, c.id, { name: "새이름" });
    expect(res.ok).toBe(true);
    const found = await getClient(ADMIN, c.id);
    expect(found?.name).toBe("새이름");
    expect(found?.contractStart?.toISOString()).toBe(start.toISOString());
  });

  it("creates and updates industry", async () => {
    const c = await createClient(ADMIN, { name: "A사", pmIds: [pmA], industry: "제조" });
    expect((await getClient(ADMIN, c.id))?.industry).toBe("제조");
    await updateClient(ADMIN, c.id, { name: "A사", industry: "IT" });
    expect((await getClient(ADMIN, c.id))?.industry).toBe("IT");
    await updateClient(ADMIN, c.id, { name: "A사", industry: null });
    expect((await getClient(ADMIN, c.id))?.industry).toBeNull();
  });

  it("setClientEasywel toggles the flag (default false)", async () => {
    const c = await createClient(ADMIN, { name: "A사", pmIds: [pmA] });
    expect((await getClient(ADMIN, c.id))?.hyundaiEasywel).toBe(false);
    expect((await setClientEasywel(ADMIN, c.id, true)).ok).toBe(true);
    expect((await getClient(ADMIN, c.id))?.hyundaiEasywel).toBe(true);
    await setClientEasywel(ADMIN, c.id, false);
    expect((await getClient(ADMIN, c.id))?.hyundaiEasywel).toBe(false);
  });

  it("PM cannot setClientEasywel on another PM's client (RLS → ok:false)", async () => {
    const b = await createClient(ADMIN, { name: "B사", pmIds: [pmB] });
    const res = await setClientEasywel({ userId: pmA, role: "PM" }, b.id, true);
    expect(res.ok).toBe(false);
    expect((await getClient(ADMIN, b.id))?.hyundaiEasywel).toBe(false);
  });

  it("archiveClient hides client from list but preserves its data", async () => {
    const c = await createClient(ADMIN, { name: "A사", pmIds: [pmA] });
    await createTask(ADMIN, { clientId: c.id, name: "과업1", unitPrice: 1000, contractCount: null });

    const res = await archiveClient(ADMIN, c.id);
    expect(res.ok).toBe(true);

    // 목록·요약에서는 사라진다.
    expect(await listClients(ADMIN)).toEqual([]);
    // 연관 데이터(과업)는 보존된다.
    const tasks = await withRLS(ADMIN, (tx) => tx.task.findMany({ where: { clientId: c.id } }));
    expect(tasks).toHaveLength(1);
    // 레코드 자체는 deletedAt만 찍힌 채 남아 있다.
    const row = await withRLS(ADMIN, (tx) => tx.client.findUnique({ where: { id: c.id } }));
    expect(row?.deletedAt).not.toBeNull();
  });

  it("archiveClient on an already-archived client returns ok:false", async () => {
    const c = await createClient(ADMIN, { name: "A사", pmIds: [pmA] });
    expect((await archiveClient(ADMIN, c.id)).ok).toBe(true);
    expect((await archiveClient(ADMIN, c.id)).ok).toBe(false);
  });

  it("PM cannot archive another PM's client (RLS → ok:false)", async () => {
    const b = await createClient(ADMIN, { name: "B사", pmIds: [pmB] });
    const res = await archiveClient({ userId: pmA, role: "PM" }, b.id);
    expect(res.ok).toBe(false);
    const row = await withRLS(ADMIN, (tx) => tx.client.findUnique({ where: { id: b.id } }));
    expect(row?.deletedAt).toBeNull();
  });

  it("listArchivedClients returns only archived; restoreClient brings it back", async () => {
    const a = await createClient(ADMIN, { name: "A사", pmIds: [pmA] });
    await createClient(ADMIN, { name: "B사", pmIds: [pmB] });
    await archiveClient(ADMIN, a.id);

    // 보관 목록엔 A사만, 일반 목록엔 B사만.
    expect((await listArchivedClients(ADMIN)).map((c) => c.name)).toEqual(["A사"]);
    expect((await listClients(ADMIN)).map((c) => c.name)).toEqual(["B사"]);

    // 복원하면 일반 목록으로 돌아오고 보관 목록에서 사라진다.
    expect((await restoreClient(ADMIN, a.id)).ok).toBe(true);
    expect(await listArchivedClients(ADMIN)).toEqual([]);
    expect((await listClients(ADMIN)).map((c) => c.name)).toEqual(["A사", "B사"]);
  });

  it("restoreClient on a non-archived client returns ok:false", async () => {
    const c = await createClient(ADMIN, { name: "A사", pmIds: [pmA] });
    expect((await restoreClient(ADMIN, c.id)).ok).toBe(false);
  });
});
