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
  it("ADMIN adds user management", () => {
    expect(hrefs("ADMIN")).toEqual(["/dashboard", "/clients", "/performance", "/expenses", "/billing", "/settings/clients", "/admin/users"]);
  });
  it("null role sees base items only (no dashboard)", () => {
    expect(hrefs(null)).toEqual(["/clients", "/performance"]);
  });
});
