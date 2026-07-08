import { describe, it, expect } from "vitest";
import { isAllowedEmail } from "@/lib/auth/domain";

describe("isAllowedEmail", () => {
  it("accepts @huno.kr", () => {
    expect(isAllowedEmail("shryu@huno.kr", "huno.kr")).toBe(true);
  });
  it("rejects other domains", () => {
    expect(isAllowedEmail("x@gmail.com", "huno.kr")).toBe(false);
  });
  it("rejects lookalike domains", () => {
    expect(isAllowedEmail("x@evilhuno.kr", "huno.kr")).toBe(false);
    expect(isAllowedEmail("x@huno.kr.evil.com", "huno.kr")).toBe(false);
  });
  it("rejects empty/null", () => {
    expect(isAllowedEmail(null, "huno.kr")).toBe(false);
    expect(isAllowedEmail("", "huno.kr")).toBe(false);
  });
  it("is case-insensitive on domain", () => {
    expect(isAllowedEmail("A@HUNO.KR", "huno.kr")).toBe(true);
  });
});
