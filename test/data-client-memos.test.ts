import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS } from "@/lib/rls";
import {
  listClientMemos, createClientMemo, updateClientMemo, deleteClientMemo, getClientMemoSummaries,
} from "@/lib/data/clientMemos";
import { mkClient } from "./factories";

const ADMIN = { userId: "seed-admin", role: "SUPER_ADMIN" as const };

async function reset() {
  await withRLS(ADMIN, async (tx) => {
    await tx.clientMemo.deleteMany();
    await tx.task.deleteMany();
    await tx.client.deleteMany();
  });
  await prisma.user.deleteMany();
}

describe("client memos data layer", () => {
  let pmA: string, pmB: string, pmC: string;
  beforeEach(async () => {
    await reset();
    pmA = (await prisma.user.create({ data: { email: "pma@huno.kr", role: "PM", status: "ACTIVE" } })).id;
    pmB = (await prisma.user.create({ data: { email: "pmb@huno.kr", role: "PM", status: "ACTIVE" } })).id;
    pmC = (await prisma.user.create({ data: { email: "pmc@huno.kr", role: "PM", status: "ACTIVE" } })).id;
  });

  it("creates memos and lists them newest-first with author", async () => {
    const c = await mkClient(ADMIN, { name: "A사", pmIds: [pmA] });
    await createClientMemo(ADMIN, { clientId: c.id, content: "메모1", authorId: pmA });
    await createClientMemo(ADMIN, { clientId: c.id, content: "메모2", authorId: pmA });
    const rows = await listClientMemos(ADMIN, c.id);
    expect(rows.map((r) => r.content)).toEqual(["메모2", "메모1"]);
    expect(rows[0].author?.email).toBe("pma@huno.kr");
  });

  it("PM sees only own client's memos (RLS)", async () => {
    const a = await mkClient(ADMIN, { name: "A사", pmIds: [pmA] });
    const b = await mkClient(ADMIN, { name: "B사", pmIds: [pmB] });
    await createClientMemo(ADMIN, { clientId: a.id, content: "A메모", authorId: pmA });
    await createClientMemo(ADMIN, { clientId: b.id, content: "B메모", authorId: pmB });
    expect((await listClientMemos({ userId: pmA, role: "PM" }, a.id)).map((r) => r.content)).toEqual(["A메모"]);
    // 다른 PM의 고객사 메모는 RLS로 보이지 않는다.
    expect(await listClientMemos({ userId: pmA, role: "PM" }, b.id)).toEqual([]);
  });

  it("an assigned PM can add/edit/delete any memo on the shared client (담당 PM 전원)", async () => {
    const c = await mkClient(ADMIN, { name: "A사", pmIds: [pmA, pmB] });
    // pmA가 작성한 메모를 pmB(같은 고객사 담당)가 수정·삭제할 수 있다.
    const m = await createClientMemo({ userId: pmA, role: "PM" }, { clientId: c.id, content: "원본", authorId: pmA });
    expect((await updateClientMemo({ userId: pmB, role: "PM" }, m.id, "수정됨")).ok).toBe(true);
    expect((await listClientMemos(ADMIN, c.id))[0].content).toBe("수정됨");
    expect((await deleteClientMemo({ userId: pmB, role: "PM" }, m.id)).ok).toBe(true);
    expect(await listClientMemos(ADMIN, c.id)).toEqual([]);
  });

  it("PM cannot edit/delete another client's memo (RLS → ok:false)", async () => {
    const b = await mkClient(ADMIN, { name: "B사", pmIds: [pmB] });
    const m = await createClientMemo(ADMIN, { clientId: b.id, content: "B메모", authorId: pmB });
    expect((await updateClientMemo({ userId: pmC, role: "PM" }, m.id, "해킹")).ok).toBe(false);
    expect((await deleteClientMemo({ userId: pmC, role: "PM" }, m.id)).ok).toBe(false);
    // 원본이 그대로 보존된다.
    expect((await listClientMemos(ADMIN, b.id))[0].content).toBe("B메모");
  });

  it("getClientMemoSummaries returns per-client count and latest content", async () => {
    const a = await mkClient(ADMIN, { name: "A사", pmIds: [pmA] });
    const b = await mkClient(ADMIN, { name: "B사", pmIds: [pmB] });
    await createClientMemo(ADMIN, { clientId: a.id, content: "A-1", authorId: pmA });
    await createClientMemo(ADMIN, { clientId: a.id, content: "A-2", authorId: pmA });
    await createClientMemo(ADMIN, { clientId: b.id, content: "B-1", authorId: pmB });

    const all = await getClientMemoSummaries(ADMIN);
    expect(all.get(a.id)).toEqual({ count: 2, latest: "A-2" });
    expect(all.get(b.id)).toEqual({ count: 1, latest: "B-1" });

    // PM 범위에서는 자기 담당 고객사만 요약에 포함된다(RLS).
    const scoped = await getClientMemoSummaries({ userId: pmA, role: "PM" });
    expect(scoped.get(a.id)?.count).toBe(2);
    expect(scoped.has(b.id)).toBe(false);
  });
});
