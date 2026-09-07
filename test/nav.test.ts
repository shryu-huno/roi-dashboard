import { describe, it, expect } from "vitest";
import { navItemsForRole } from "@/lib/shell/nav";

const hrefs = (role: Parameters<typeof navItemsForRole>[0]) => navItemsForRole(role).map((i) => i.href);

describe("navItemsForRole", () => {
  it("PM sees dashboard first, then clients/performance/expenses/billing, then settings", () => {
    expect(hrefs("PM")).toEqual(["/dashboard", "/clients", "/performance", "/expenses", "/billing", "/settings/clients"]);
  });
  it("SETTLEMENT adds settings", () => {
    expect(hrefs("SETTLEMENT")).toEqual(["/dashboard", "/clients", "/performance", "/expenses", "/billing", "/settings/clients"]);
  });
  it("team ADMIN gets no admin links (팀 관리자는 사용자·팀 관리 없음)", () => {
    expect(hrefs("ADMIN")).toEqual(["/dashboard", "/clients", "/performance", "/expenses", "/billing", "/settings/clients"]);
  });
  it("PART_LEADER gets the same base items, no admin links", () => {
    expect(hrefs("PART_LEADER")).toEqual(["/dashboard", "/clients", "/performance", "/expenses", "/billing", "/settings/clients"]);
  });
  it("SUPER_ADMIN adds team and user management", () => {
    expect(hrefs("SUPER_ADMIN")).toEqual(["/dashboard", "/clients", "/performance", "/expenses", "/billing", "/settings/clients", "/admin/teams", "/admin/users"]);
  });
  it("null role sees base items only (no dashboard)", () => {
    expect(hrefs(null)).toEqual(["/clients", "/performance"]);
  });
});
