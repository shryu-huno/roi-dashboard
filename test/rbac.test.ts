import { describe, it, expect } from "vitest";
import { hasAtLeast, canManageUsers, canManageTeams, canEditSettlement, isAllAccess, isTeamAdmin, isPartLeader, isTeamScoped } from "@/lib/auth/rbac";

describe("hasAtLeast (hierarchy SUPER_ADMIN > ADMIN > PART_LEADER > SETTLEMENT > PM)", () => {
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
  it("PART_LEADER satisfies PM (approved user) but not ADMIN", () => {
    expect(hasAtLeast("PART_LEADER", "PM")).toBe(true);
    expect(hasAtLeast("PART_LEADER", "ADMIN")).toBe(false);
    expect(hasAtLeast("PART_LEADER", "SUPER_ADMIN")).toBe(false);
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
  it("isAllAccess = SUPER_ADMIN or SETTLEMENT (not team ADMIN, not PART_LEADER)", () => {
    expect(isAllAccess("SUPER_ADMIN")).toBe(true);
    expect(isAllAccess("SETTLEMENT")).toBe(true);
    expect(isAllAccess("ADMIN")).toBe(false);
    expect(isAllAccess("PART_LEADER")).toBe(false);
    expect(isAllAccess("PM")).toBe(false);
  });
  it("isTeamAdmin is only ADMIN", () => {
    expect(isTeamAdmin("ADMIN")).toBe(true);
    expect(isTeamAdmin("PART_LEADER")).toBe(false);
    expect(isTeamAdmin("SUPER_ADMIN")).toBe(false);
    expect(isTeamAdmin("PM")).toBe(false);
  });
  it("isPartLeader is only PART_LEADER", () => {
    expect(isPartLeader("PART_LEADER")).toBe(true);
    expect(isPartLeader("ADMIN")).toBe(false);
    expect(isPartLeader("PM")).toBe(false);
  });
  it("isTeamScoped = team ADMIN or PART_LEADER (scoped managers)", () => {
    expect(isTeamScoped("ADMIN")).toBe(true);
    expect(isTeamScoped("PART_LEADER")).toBe(true);
    expect(isTeamScoped("SUPER_ADMIN")).toBe(false);
    expect(isTeamScoped("SETTLEMENT")).toBe(false);
    expect(isTeamScoped("PM")).toBe(false);
  });
  it("settlement editing is all-access only (team ADMIN excluded)", () => {
    expect(canEditSettlement("SUPER_ADMIN")).toBe(true);
    expect(canEditSettlement("SETTLEMENT")).toBe(true);
    expect(canEditSettlement("ADMIN")).toBe(false);
    expect(canEditSettlement("PM")).toBe(false);
  });
});
