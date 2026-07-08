import { describe, it, expect } from "vitest";
import { hasAtLeast, canManageUsers, canEditSettlement } from "@/lib/auth/rbac";

describe("hasAtLeast (hierarchy ADMIN > SETTLEMENT > PM)", () => {
  it("ADMIN satisfies every requirement", () => {
    expect(hasAtLeast("ADMIN", "PM")).toBe(true);
    expect(hasAtLeast("ADMIN", "SETTLEMENT")).toBe(true);
    expect(hasAtLeast("ADMIN", "ADMIN")).toBe(true);
  });
  it("PM does not satisfy SETTLEMENT/ADMIN", () => {
    expect(hasAtLeast("PM", "SETTLEMENT")).toBe(false);
    expect(hasAtLeast("PM", "ADMIN")).toBe(false);
    expect(hasAtLeast("PM", "PM")).toBe(true);
  });
  it("null role satisfies nothing", () => {
    expect(hasAtLeast(null, "PM")).toBe(false);
  });
});

describe("permission predicates", () => {
  it("only ADMIN manages users", () => {
    expect(canManageUsers("ADMIN")).toBe(true);
    expect(canManageUsers("SETTLEMENT")).toBe(false);
    expect(canManageUsers("PM")).toBe(false);
  });
  it("ADMIN and SETTLEMENT edit settlement data", () => {
    expect(canEditSettlement("ADMIN")).toBe(true);
    expect(canEditSettlement("SETTLEMENT")).toBe(true);
    expect(canEditSettlement("PM")).toBe(false);
  });
});
