import { describe, it, expect } from "vitest";
import {
  performanceBatchSchema,
  expenseSchema,
  billingSchema,
  taskSchema,
} from "@/lib/validation/schemas";

describe("performanceBatchSchema", () => {
  it("accepts a valid batch", () => {
    const r = performanceBatchSchema.safeParse({
      clientId: "c1", year: "2026", month: "3", rows: [{ taskId: "t1", count: "4" }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.rows[0].count).toBe(4);
  });
  it("rejects negative count", () => {
    const r = performanceBatchSchema.safeParse({
      clientId: "c1", year: 2026, month: 3, rows: [{ taskId: "t1", count: -1 }],
    });
    expect(r.success).toBe(false);
  });
  it("rejects month out of range", () => {
    expect(performanceBatchSchema.safeParse({ clientId: "c1", year: 2026, month: 13, rows: [] }).success).toBe(false);
    expect(performanceBatchSchema.safeParse({ clientId: "c1", year: 2026, month: 0, rows: [] }).success).toBe(false);
  });
  it("rejects non-integer count", () => {
    expect(performanceBatchSchema.safeParse({ clientId: "c1", year: 2026, month: 3, rows: [{ taskId: "t1", count: 1.5 }] }).success).toBe(false);
  });
});

describe("expenseSchema", () => {
  it("accepts a valid expense with memo", () => {
    const r = expenseSchema.safeParse({ clientId: "c1", year: 2026, month: 3, category: "OPS_FOOD", amount: 5000, memo: "회식" });
    expect(r.success).toBe(true);
  });
  it("rejects unknown category", () => {
    expect(expenseSchema.safeParse({ clientId: "c1", year: 2026, month: 3, category: "NOPE", amount: 1 }).success).toBe(false);
  });
  it("rejects negative amount", () => {
    expect(expenseSchema.safeParse({ clientId: "c1", year: 2026, month: 3, category: "OPS_FOOD", amount: -1 }).success).toBe(false);
  });
});

describe("billingSchema (null vs 0)", () => {
  it("treats empty string as null (미입력)", () => {
    const r = billingSchema.safeParse({ clientId: "c1", year: 2026, month: 3, amount: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.amount).toBeNull();
  });
  it("keeps 0 as 0 (0원)", () => {
    const r = billingSchema.safeParse({ clientId: "c1", year: 2026, month: 3, amount: "0" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.amount).toBe(0);
  });
  it("rejects negative amount", () => {
    expect(billingSchema.safeParse({ clientId: "c1", year: 2026, month: 3, amount: -5 }).success).toBe(false);
  });
});

describe("taskSchema", () => {
  it("accepts a task with null contractAmount", () => {
    const r = taskSchema.safeParse({ clientId: "c1", name: "심리진단", unitPrice: 10000, contractAmount: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.contractAmount).toBeNull();
  });
  it("rejects empty name", () => {
    expect(taskSchema.safeParse({ clientId: "c1", name: "", unitPrice: 100 }).success).toBe(false);
  });
});
