import { describe, it, expect } from "vitest";
import { signInCallback } from "@/lib/auth/config";

function makeParams(email: string | null) {
  return { user: { email } } as Parameters<typeof signInCallback>[0];
}

describe("signInCallback", () => {
  it("allows @huno.kr", async () => {
    expect(await signInCallback(makeParams("a@huno.kr"))).toBe(true);
  });
  it("blocks non-huno.kr", async () => {
    expect(await signInCallback(makeParams("a@gmail.com"))).toBe(false);
  });
  it("blocks missing email", async () => {
    expect(await signInCallback(makeParams(null))).toBe(false);
  });
});
