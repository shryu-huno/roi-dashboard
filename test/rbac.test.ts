import { describe, it, expect } from "vitest";
import { hasAtLeast, canManageUsers, canManageTeams, canEditSettlement, isAllAccess, isTeamAdmin } from "@/lib/auth/rbac";

describe("hasAtLeast (hierarchy SUPER_ADMIN > ADMIN > SETTLEMENT > PM)", () => {
  it("SUPER_ADMIN satisfies every requirement", () => {
    expect(hasAtLeast("SUPER_ADMIN", "PM")).toBe(true);
    expect(hasAtLeast("SUPER_ADMIN", "SETTLEMENT")).toBe(true);
    expect(hasAtLeast("SUPER_ADMIN", "ADMIN")).toBe(true);
  });
  it("ADMIN satisfies PM/SETTLEMENT/ADMIN by rank", () => {
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
  it("only SUPER_ADMIN manages users and teams", () => {
    expect(canManageUsers("SUPER_ADMIN")).toBe(true);
    expect(canManageUsers("ADMIN")).toBe(false);
    expect(canManageUsers("SETTLEMENT")).toBe(false);
    expect(canManageUsers("PM")).toBe(false);
    expect(canManageTeams("SUPER_ADMIN")).toBe(true);
    expect(canManageTeams("ADMIN")).toBe(false);
  });
  it("isAllAccess = SUPER_ADMIN or SETTLEMENT (not team ADMIN)", () => {
    expect(isAllAccess("SUPER_ADMIN")).toBe(true);
    expect(isAllAccess("SETTLEMENT")).toBe(true);
    expect(isAllAccess("ADMIN")).toBe(false);
    expect(isAllAccess("PM")).toBe(false);
  });
  it("isTeamAdmin is only ADMIN", () => {
    expect(isTeamAdmin("ADMIN")).toBe(true);
    expect(isTeamAdmin("SUPER_ADMIN")).toBe(false);
    expect(isTeamAdmin("PM")).toBe(false);
  });
  it("settlement editing is all-access only (team ADMIN excluded)", () => {
    expect(canEditSettlement("SUPER_ADMIN")).toBe(true);
    expect(canEditSettlement("SETTLEMENT")).toBe(true);
    expect(canEditSettlement("ADMIN")).toBe(false);
    expect(canEditSettlement("PM")).toBe(false);
  });
});
