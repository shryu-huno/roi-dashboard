import { describe, it, expect } from "vitest";
import { navItemsForRole } from "@/lib/shell/nav";

const hrefs = (role: Parameters<typeof navItemsForRole>[0]) => navItemsForRole(role).map((i) => i.href);

describe("navItemsForRole", () => {
  it("PM sees clients, performance, expenses, billing (no settings)", () => {
    expect(hrefs("PM")).toEqual(["/clients", "/performance", "/expenses", "/billing"]);
  });
  it("SETTLEMENT adds settings", () => {
    expect(hrefs("SETTLEMENT")).toEqual(["/clients", "/performance", "/expenses", "/billing", "/settings/clients"]);
  });
  it("ADMIN adds user management", () => {
    expect(hrefs("ADMIN")).toEqual(["/clients", "/performance", "/expenses", "/billing", "/settings/clients", "/admin/users"]);
  });
  it("null role sees base items only", () => {
    expect(hrefs(null)).toEqual(["/clients", "/performance"]);
  });
});
