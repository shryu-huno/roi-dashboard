import { describe, it, expect } from "vitest";
import {
  performanceBatchSchema,
  expenseSchema,
  billingSchema,
  taskSchema,
  clientSchema,
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
  it("strips thousands separators from amount", () => {
    const r = expenseSchema.safeParse({ clientId: "c1", year: 2026, month: 3, category: "OPS_FOOD", amount: "50,000" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.amount).toBe(50000);
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
  it("strips thousands separators from amount", () => {
    const r = billingSchema.safeParse({ clientId: "c1", year: 2026, month: 3, amount: "1,000,000" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.amount).toBe(1000000);
  });
  it("rejects negative amount", () => {
    expect(billingSchema.safeParse({ clientId: "c1", year: 2026, month: 3, amount: -5 }).success).toBe(false);
  });
});

describe("taskSchema", () => {
  it("accepts a task with null contractCount (미입력)", () => {
    const r = taskSchema.safeParse({ clientId: "c1", name: "심리진단", unitPrice: 10000, contractCount: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.contractCount).toBeNull();
  });
  it("accepts a contractCount", () => {
    const r = taskSchema.safeParse({ clientId: "c1", name: "심리진단", unitPrice: 10000, contractCount: "12" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.contractCount).toBe(12);
  });
  it("strips thousands separators from unitPrice", () => {
    const r = taskSchema.safeParse({ clientId: "c1", name: "심리진단", unitPrice: "1,000,000", contractCount: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.unitPrice).toBe(1000000);
  });
  it("rejects empty name", () => {
    expect(taskSchema.safeParse({ clientId: "c1", name: "", unitPrice: 100 }).success).toBe(false);
  });
  it("rejects empty-string unitPrice", () => {
    expect(taskSchema.safeParse({ clientId: "c1", name: "x", unitPrice: "" }).success).toBe(false);
  });
});

describe("expenseSchema – blank amount", () => {
  it("rejects empty-string amount", () => {
    expect(expenseSchema.safeParse({ clientId: "c1", year: 2026, month: 3, category: "OPS_FOOD", amount: "" }).success).toBe(false);
  });
});

describe("performanceBatchSchema – blank count & year bounds", () => {
  it("still accepts valid numeric-string count", () => {
    const r = performanceBatchSchema.safeParse({
      clientId: "c1", year: "2026", month: "3", rows: [{ taskId: "t1", count: "4" }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.rows[0].count).toBe(4);
  });
  it("rejects empty-string count in a row", () => {
    expect(performanceBatchSchema.safeParse({
      clientId: "c1", year: 2026, month: 3, rows: [{ taskId: "t1", count: "" }],
    }).success).toBe(false);
  });
  it("rejects year below range (1999)", () => {
    expect(performanceBatchSchema.safeParse({ clientId: "c1", year: 1999, month: 3, rows: [] }).success).toBe(false);
  });
  it("rejects year above range (2101)", () => {
    expect(performanceBatchSchema.safeParse({ clientId: "c1", year: 2101, month: 3, rows: [] }).success).toBe(false);
  });
});

describe("clientSchema industry", () => {
  it("maps empty string industry to null", () => {
    const r = clientSchema.safeParse({ name: "A사", industry: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.industry).toBeNull();
  });
  it("keeps a provided industry", () => {
    const r = clientSchema.safeParse({ name: "A사", industry: "제조" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.industry).toBe("제조");
  });
});
