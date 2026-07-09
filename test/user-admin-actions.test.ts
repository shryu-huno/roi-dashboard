import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";

// actions.ts 는 requireRole 경유로 @/lib/auth(NextAuth 런타임)을 top-level import 한다.
// applyApproval/applyStatus 는 세션 비의존이므로 node 환경에서 전이 import 가 깨지지 않도록 스텁한다.
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { applyApproval, applyStatus } from "@/app/(app)/admin/users/actions";

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
