import { describe, it, expect } from "vitest";
import { add } from "@/lib/smoke";

describe("smoke", () => {
  it("adds numbers", () => {
    expect(add(2, 3)).toBe(5);
  });
});
