import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";

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

describe("applyStatus", () => {
  it("deactivates a user", async () => {
    const u = await prisma.user.create({ data: { email: "q@huno.kr", role: "PM", status: "ACTIVE" } });
    const res = await applyStatus({ userId: u.id, status: "INACTIVE" });
    expect(res.ok).toBe(true);
    const after = await prisma.user.findUnique({ where: { id: u.id } });
    expect(after?.status).toBe("INACTIVE");
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
