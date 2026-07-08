import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/db";

afterEach(async () => {
  await prisma.user.deleteMany();
});

describe("prisma connection", () => {
  it("creates and reads a user with PENDING default status", async () => {
    const user = await prisma.user.create({
      data: { email: "a@huno.kr", name: "A" },
    });
    expect(user.status).toBe("PENDING");
    expect(user.role).toBeNull();

    const found = await prisma.user.findUnique({ where: { email: "a@huno.kr" } });
    expect(found?.id).toBe(user.id);
  });
});
