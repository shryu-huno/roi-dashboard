import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS, type RlsContext } from "@/lib/rls";

// actions.ts 는 requireRole 경유로 @/lib/auth(NextAuth 런타임)을 top-level import 한다.
// applyApproval/applyStatus 는 세션 비의존이므로 node 환경에서 전이 import 가 깨지지 않도록 스텁한다.
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { applyApproval, applyStatus, applyHardDelete } from "@/app/(app)/admin/users/actions";

beforeEach(async () => {
  await prisma.user.deleteMany();
});

describe("applyApproval", () => {
  it("activates a pending user and assigns role", async () => {
    const u = await prisma.user.create({ data: { email: "p@huno.kr" } });
    const res = await applyApproval({ userId: u.id, role: "PM" });
    expect(res.ok).toBe(true);
    const after = await prisma.user.findUnique({ where: { id: u.id } });
    expect(after?.status).toBe("ACTIVE");
    expect(after?.role).toBe("PM");
  });

  it("returns error for unknown user", async () => {
    const res = await applyApproval({ userId: "nope", role: "PM" });
    expect(res.ok).toBe(false);
  });
});

describe("applyApproval — 파트 배정", () => {
  let teamId: string;
  let partA: string;
  let partB: string;
  const SUPER: RlsContext = { userId: "super", role: "SUPER_ADMIN" };

  beforeEach(async () => {
    await withRLS(SUPER, (tx) => tx.team.deleteMany());
    teamId = (await withRLS(SUPER, (tx) => tx.team.create({ data: { name: "사업운영팀" } }))).id;
    partA = (await withRLS(SUPER, (tx) => tx.part.create({ data: { teamId, name: "1파트" } }))).id;
    partB = (await withRLS(SUPER, (tx) => tx.part.create({ data: { teamId, name: "2파트" } }))).id;
  });

  it("PM을 파트에 배정하면 그 파트 파트장이 소속 파트장(partLeaderId)이 된다", async () => {
    const leader = await prisma.user.create({ data: { email: "l@huno.kr" } });
    await applyApproval({ userId: leader.id, role: "PART_LEADER", teamId, partId: partA });
    const pm = await prisma.user.create({ data: { email: "p@huno.kr" } });
    const res = await applyApproval({ userId: pm.id, role: "PM", teamId, partId: partA });
    expect(res.ok).toBe(true);
    const after = await prisma.user.findUnique({ where: { id: pm.id } });
    expect(after?.partId).toBe(partA);
    expect(after?.partLeaderId).toBe(leader.id);
  });

  it("파트장을 나중에 지정하면 이미 그 파트에 있던 PM의 소속 파트장도 채워진다", async () => {
    const pm = await prisma.user.create({ data: { email: "p@huno.kr" } });
    await applyApproval({ userId: pm.id, role: "PM", teamId, partId: partA });
    expect((await prisma.user.findUnique({ where: { id: pm.id } }))?.partLeaderId).toBeNull();
    const leader = await prisma.user.create({ data: { email: "l@huno.kr" } });
    await applyApproval({ userId: leader.id, role: "PART_LEADER", teamId, partId: partA });
    expect((await prisma.user.findUnique({ where: { id: pm.id } }))?.partLeaderId).toBe(leader.id);
  });

  it("PM을 다른 파트로 옮기면 소속 파트장도 새 파트의 파트장으로 바뀐다", async () => {
    const l1 = await prisma.user.create({ data: { email: "l1@huno.kr" } });
    const l2 = await prisma.user.create({ data: { email: "l2@huno.kr" } });
    await applyApproval({ userId: l1.id, role: "PART_LEADER", teamId, partId: partA });
    await applyApproval({ userId: l2.id, role: "PART_LEADER", teamId, partId: partB });
    const pm = await prisma.user.create({ data: { email: "p@huno.kr" } });
    await applyApproval({ userId: pm.id, role: "PM", teamId, partId: partA });
    await applyApproval({ userId: pm.id, role: "PM", teamId, partId: partB });
    expect((await prisma.user.findUnique({ where: { id: pm.id } }))?.partLeaderId).toBe(l2.id);
  });

  it("한 파트에 파트장은 한 명만 둘 수 있다", async () => {
    const l1 = await prisma.user.create({ data: { email: "l1@huno.kr" } });
    const l2 = await prisma.user.create({ data: { email: "l2@huno.kr" } });
    expect((await applyApproval({ userId: l1.id, role: "PART_LEADER", teamId, partId: partA })).ok).toBe(true);
    const res = await applyApproval({ userId: l2.id, role: "PART_LEADER", teamId, partId: partA });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("파트장");
  });

  it("같은 파트장을 다시 저장하는 것은 허용한다", async () => {
    const l1 = await prisma.user.create({ data: { email: "l1@huno.kr" } });
    await applyApproval({ userId: l1.id, role: "PART_LEADER", teamId, partId: partA });
    expect((await applyApproval({ userId: l1.id, role: "PART_LEADER", teamId, partId: partA })).ok).toBe(true);
  });

  it("선택한 팀에 속하지 않은 파트는 거부한다", async () => {
    const other = (await withRLS(SUPER, (tx) => tx.team.create({ data: { name: "다른팀" } }))).id;
    const pm = await prisma.user.create({ data: { email: "p@huno.kr" } });
    const res = await applyApproval({ userId: pm.id, role: "PM", teamId: other, partId: partA });
    expect(res.ok).toBe(false);
    const res2 = await applyApproval({ userId: pm.id, role: "PM", teamId: null, partId: partA });
    expect(res2.ok).toBe(false);
  });

  it("PM·파트장이 아닌 역할은 파트를 저장하지 않는다", async () => {
    const admin = await prisma.user.create({ data: { email: "a@huno.kr" } });
    await applyApproval({ userId: admin.id, role: "ADMIN", teamId, partId: partA });
    const after = await prisma.user.findUnique({ where: { id: admin.id } });
    expect(after?.partId).toBeNull();
    expect(after?.partLeaderId).toBeNull();
  });

  it("파트 배정 전의 기존 PM은 저장해도 기존 소속 파트장(권한)을 잃지 않는다", async () => {
    const legacyLeader = await prisma.user.create({ data: { email: "ll@huno.kr", role: "PART_LEADER", status: "ACTIVE" } });
    const pm = await prisma.user.create({ data: { email: "p@huno.kr", role: "PM", status: "ACTIVE", teamId, partLeaderId: legacyLeader.id } });
    await applyApproval({ userId: pm.id, role: "PM", teamId, partId: null });
    expect((await prisma.user.findUnique({ where: { id: pm.id } }))?.partLeaderId).toBe(legacyLeader.id);
  });

  it("PM을 파트에서 빼면 소속 파트장도 해제된다", async () => {
    const leader = await prisma.user.create({ data: { email: "l@huno.kr" } });
    await applyApproval({ userId: leader.id, role: "PART_LEADER", teamId, partId: partA });
    const pm = await prisma.user.create({ data: { email: "p@huno.kr" } });
    await applyApproval({ userId: pm.id, role: "PM", teamId, partId: partA });
    await applyApproval({ userId: pm.id, role: "PM", teamId, partId: null });
    const after = await prisma.user.findUnique({ where: { id: pm.id } });
    expect(after?.partId).toBeNull();
    expect(after?.partLeaderId).toBeNull();
  });

  it("파트장을 PM으로 바꾸면 이전 파트 PM들의 소속 파트장이 해제된다", async () => {
    const leader = await prisma.user.create({ data: { email: "l@huno.kr" } });
    await applyApproval({ userId: leader.id, role: "PART_LEADER", teamId, partId: partA });
    const pm = await prisma.user.create({ data: { email: "p@huno.kr" } });
    await applyApproval({ userId: pm.id, role: "PM", teamId, partId: partA });
    await applyApproval({ userId: leader.id, role: "PM", teamId, partId: partA });
    expect((await prisma.user.findUnique({ where: { id: pm.id } }))?.partLeaderId).toBeNull();
  });
});

describe("applyStatus", () => {
  it("deactivates a user", async () => {
    const u = await prisma.user.create({ data: { email: "q@huno.kr", role: "PM", status: "ACTIVE" } });
    const res = await applyStatus({ userId: u.id, status: "INACTIVE" });
    expect(res.ok).toBe(true);
    const after = await prisma.user.findUnique({ where: { id: u.id } });
    expect(after?.status).toBe("INACTIVE");
  });

  it("파트장을 비활성화하면 그 파트 PM의 소속 파트장이 해제된다", async () => {
    const SUPER: RlsContext = { userId: "super", role: "SUPER_ADMIN" };
    await withRLS(SUPER, (tx) => tx.team.deleteMany());
    const teamId = (await withRLS(SUPER, (tx) => tx.team.create({ data: { name: "T" } }))).id;
    const partId = (await withRLS(SUPER, (tx) => tx.part.create({ data: { teamId, name: "1파트" } }))).id;
    const leader = await prisma.user.create({ data: { email: "l@huno.kr" } });
    await applyApproval({ userId: leader.id, role: "PART_LEADER", teamId, partId });
    const pm = await prisma.user.create({ data: { email: "p@huno.kr" } });
    await applyApproval({ userId: pm.id, role: "PM", teamId, partId });
    expect((await prisma.user.findUnique({ where: { id: pm.id } }))?.partLeaderId).toBe(leader.id);
    await applyStatus({ userId: leader.id, status: "INACTIVE" });
    expect((await prisma.user.findUnique({ where: { id: pm.id } }))?.partLeaderId).toBeNull();
  });
});

describe("applyHardDelete", () => {
  it("INACTIVE 사용자를 삭제한다", async () => {
    const u = await prisma.user.create({ data: { email: "del@huno.kr", role: "PM", status: "INACTIVE" } });
    const res = await applyHardDelete({ userId: u.id });
    expect(res.ok).toBe(true);
    const after = await prisma.user.findUnique({ where: { id: u.id } });
    expect(after).toBeNull();
  });

  it("ACTIVE 사용자는 삭제하지 않는다", async () => {
    const u = await prisma.user.create({ data: { email: "keep@huno.kr", role: "PM", status: "ACTIVE" } });
    const res = await applyHardDelete({ userId: u.id });
    expect(res.ok).toBe(false);
    const after = await prisma.user.findUnique({ where: { id: u.id } });
    expect(after).not.toBeNull();
  });

  it("존재하지 않는 사용자는 error", async () => {
    const res = await applyHardDelete({ userId: "nope" });
    expect(res.ok).toBe(false);
  });
});
