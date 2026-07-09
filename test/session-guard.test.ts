import { describe, it, expect, vi } from "vitest";

// resolveGuard 는 순수 함수라 auth 런타임이 불필요하다.
// session.ts 가 top-level 로 @/lib/auth(NextAuth 런타임)를 import 하므로,
// node 환경에서 next-auth 전이 import 가 깨지지 않도록 스텁한다.
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { resolveGuard } from "@/lib/auth/session";

describe("resolveGuard", () => {
  it("redirects unauthenticated to /login", () => {
    expect(resolveGuard(null, null)).toEqual({ redirect: "/login" });
  });
  it("redirects PENDING to /pending", () => {
    expect(resolveGuard({ status: "PENDING", role: null }, null)).toEqual({ redirect: "/pending" });
  });
  it("redirects INACTIVE to /pending", () => {
    expect(resolveGuard({ status: "INACTIVE", role: "PM" }, null)).toEqual({ redirect: "/pending" });
  });
  it("allows ACTIVE user with no role requirement", () => {
    expect(resolveGuard({ status: "ACTIVE", role: "PM" }, null)).toEqual({ ok: true });
  });
  it("blocks insufficient role", () => {
    expect(resolveGuard({ status: "ACTIVE", role: "PM" }, "ADMIN")).toEqual({ redirect: "/" });
  });
  it("allows sufficient role", () => {
    expect(resolveGuard({ status: "ACTIVE", role: "ADMIN" }, "SETTLEMENT")).toEqual({ ok: true });
  });
});
