import { describe, it, expect } from "vitest";
import { getRlsContext } from "@/lib/context";

describe("getRlsContext", () => {
  it("maps an approved user to an RLS context", () => {
    expect(getRlsContext({ id: "u1", role: "PM" })).toEqual({ userId: "u1", role: "PM", teamId: null });
    expect(getRlsContext({ id: "u2", role: "ADMIN", teamId: "t1" })).toEqual({ userId: "u2", role: "ADMIN", teamId: "t1" });
  });
  it("throws when role is null (unapproved user should never reach data layer)", () => {
    expect(() => getRlsContext({ id: "u3", role: null })).toThrow(/역할/);
  });
});
