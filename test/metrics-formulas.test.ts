import { describe, it, expect } from "vitest";
import { margin, attainment, billingRate, collectionRate } from "@/lib/metrics/formulas";

describe("margin (수익률)", () => {
  it("computes (perf - expense) / perf", () => {
    expect(margin(1000, 300)).toBeCloseTo(0.7);
  });
  it("allows negative (적자)", () => {
    expect(margin(1000, 1500)).toBeCloseTo(-0.5);
  });
  it("returns null when performance is 0", () => {
    expect(margin(0, 300)).toBeNull();
  });
});

describe("attainment (달성률)", () => {
  it("computes perf / contract", () => {
    expect(attainment(600, 1000)).toBeCloseTo(0.6);
  });
  it("returns null when contract is 0 (계약금 없음)", () => {
    expect(attainment(600, 0)).toBeNull();
  });
});

describe("billingRate (청구율)", () => {
  it("computes billing / perf", () => {
    expect(billingRate(800, 1000)).toBeCloseTo(0.8);
  });
  it("returns null when performance is 0", () => {
    expect(billingRate(800, 0)).toBeNull();
  });
});

describe("collectionRate (수금률)", () => {
  it("computes deposit / billing", () => {
    expect(collectionRate(500, 800)).toBeCloseTo(0.625);
  });
  it("returns null when billing is 0", () => {
    expect(collectionRate(500, 0)).toBeNull();
  });
});
