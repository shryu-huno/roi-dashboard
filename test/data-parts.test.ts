import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS, type RlsContext } from "@/lib/rls";
import { createPart, renamePart, deletePart, deleteTeam, syncPartLeaders } from "@/lib/data/parts";

const SUPER: RlsContext = { userId: "super", role: "SUPER_ADMIN" };
const PM_CTX: RlsContext = { userId: "pm", role: "PM" };

let teamId: string;

beforeEach(async () => {
  await prisma.user.deleteMany();
  await withRLS(SUPER, (tx) => tx.team.deleteMany()); // Part는 팀 삭제로 함께 정리(Cascade)
  teamId = (await withRLS(SUPER, (tx) => tx.team.create({ data: { name: "사업운영팀" } }))).id;
});

describe("createPart / renamePart", () => {
  it("팀 아래에 파트를 만든다", async () => {
    const res = await createPart(SUPER, teamId, "1파트");
    expect(res.ok).toBe(true);
    const parts = await withRLS(SUPER, (tx) => tx.part.findMany({ where: { teamId } }));
    expect(parts.map((p) => p.name)).toEqual(["1파트"]);
  });

  it("같은 팀에 같은 이름의 파트는 만들 수 없다", async () => {
    await createPart(SUPER, teamId, "1파트");
    const res = await createPart(SUPER, teamId, "1파트");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("이미");
  });

  it("빈 이름은 거부한다", async () => {
    const res = await createPart(SUPER, teamId, "   ");
    expect(res.ok).toBe(false);
  });

  it("이름을 바꾼다", async () => {
    await createPart(SUPER, teamId, "1파트");
    const part = (await withRLS(SUPER, (tx) => tx.part.findFirst({ where: { teamId } })))!;
    const res = await renamePart(SUPER, part.id, "A파트");
    expect(res.ok).toBe(true);
    const after = await withRLS(SUPER, (tx) => tx.part.findUnique({ where: { id: part.id } }));
    expect(after?.name).toBe("A파트");
  });

  it("최고관리자가 아니면 DB(RLS)가 파트 생성을 막는다", async () => {
    await expect(createPart(PM_CTX, teamId, "몰래파트")).rejects.toThrow();
  });
});

describe("syncPartLeaders", () => {
  it("PM의 소속 파트장(partLeaderId)을 파트의 활성 파트장으로 맞춘다", async () => {
    await createPart(SUPER, teamId, "1파트");
    const part = (await prisma.part.findFirst({ where: { teamId } }))!;
    const leader = await prisma.user.create({ data: { email: "l@huno.kr", role: "PART_LEADER", status: "ACTIVE", teamId, partId: part.id } });
    const pm = await prisma.user.create({ data: { email: "p@huno.kr", role: "PM", status: "ACTIVE", teamId, partId: part.id } });
    await prisma.$transaction((tx) => syncPartLeaders(tx, [part.id]));
    expect((await prisma.user.findUnique({ where: { id: pm.id } }))?.partLeaderId).toBe(leader.id);
  });

  it("파트장이 없으면 PM의 partLeaderId를 비운다", async () => {
    await createPart(SUPER, teamId, "1파트");
    const part = (await prisma.part.findFirst({ where: { teamId } }))!;
    const stale = await prisma.user.create({ data: { email: "old@huno.kr", role: "PART_LEADER", status: "ACTIVE" } });
    const pm = await prisma.user.create({ data: { email: "p@huno.kr", role: "PM", status: "ACTIVE", teamId, partId: part.id, partLeaderId: stale.id } });
    await prisma.$transaction((tx) => syncPartLeaders(tx, [part.id]));
    expect((await prisma.user.findUnique({ where: { id: pm.id } }))?.partLeaderId).toBeNull();
  });

  it("비활성 파트장은 파트장으로 보지 않는다", async () => {
    await createPart(SUPER, teamId, "1파트");
    const part = (await prisma.part.findFirst({ where: { teamId } }))!;
    await prisma.user.create({ data: { email: "l@huno.kr", role: "PART_LEADER", status: "INACTIVE", teamId, partId: part.id } });
    const pm = await prisma.user.create({ data: { email: "p@huno.kr", role: "PM", status: "ACTIVE", teamId, partId: part.id } });
    await prisma.$transaction((tx) => syncPartLeaders(tx, [part.id]));
    expect((await prisma.user.findUnique({ where: { id: pm.id } }))?.partLeaderId).toBeNull();
  });

  it("다른 파트의 PM은 건드리지 않는다", async () => {
    await createPart(SUPER, teamId, "1파트");
    await createPart(SUPER, teamId, "2파트");
    const [p1, p2] = await prisma.part.findMany({ where: { teamId }, orderBy: { name: "asc" } });
    const leader = await prisma.user.create({ data: { email: "l@huno.kr", role: "PART_LEADER", status: "ACTIVE", partId: p1.id } });
    const other = await prisma.user.create({ data: { email: "o@huno.kr", role: "PM", status: "ACTIVE", partId: p2.id, partLeaderId: leader.id } });
    await prisma.$transaction((tx) => syncPartLeaders(tx, [p1.id]));
    expect((await prisma.user.findUnique({ where: { id: other.id } }))?.partLeaderId).toBe(leader.id);
  });
});

describe("deletePart / deleteTeam", () => {
  it("파트를 지우면 소속 인원의 파트와 PM의 소속 파트장이 함께 해제된다(팀은 유지)", async () => {
    await createPart(SUPER, teamId, "1파트");
    const part = (await prisma.part.findFirst({ where: { teamId } }))!;
    const leader = await prisma.user.create({ data: { email: "l@huno.kr", role: "PART_LEADER", status: "ACTIVE", teamId, partId: part.id } });
    const pm = await prisma.user.create({ data: { email: "p@huno.kr", role: "PM", status: "ACTIVE", teamId, partId: part.id, partLeaderId: leader.id } });
    const res = await deletePart(SUPER, part.id);
    expect(res.ok).toBe(true);
    const after = await prisma.user.findUnique({ where: { id: pm.id } });
    expect(after?.partId).toBeNull();
    expect(after?.partLeaderId).toBeNull();
    expect(after?.teamId).toBe(teamId);
    expect((await prisma.user.findUnique({ where: { id: leader.id } }))?.partId).toBeNull();
  });

  it("팀을 지우면 그 팀 파트 소속 PM의 소속 파트장도 해제된다", async () => {
    await createPart(SUPER, teamId, "1파트");
    const part = (await prisma.part.findFirst({ where: { teamId } }))!;
    const leader = await prisma.user.create({ data: { email: "l@huno.kr", role: "PART_LEADER", status: "ACTIVE", teamId, partId: part.id } });
    const pm = await prisma.user.create({ data: { email: "p@huno.kr", role: "PM", status: "ACTIVE", teamId, partId: part.id, partLeaderId: leader.id } });
    const res = await deleteTeam(SUPER, teamId);
    expect(res.ok).toBe(true);
    const after = await prisma.user.findUnique({ where: { id: pm.id } });
    expect(after?.partId).toBeNull();
    expect(after?.partLeaderId).toBeNull();
    expect(after?.teamId).toBeNull();
    expect(await prisma.part.count()).toBe(0);
  });
});
