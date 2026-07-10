import { describe, it, expect } from "vitest";
import { filterClients, sortClients, paginate, type ClientRow } from "@/lib/clients/summary-view";

function row(name: string, pmLabel: string, industry: string | null): ClientRow {
  return { id: name, name, pmLabel, industry, performance: 0, expense: 0, contract: 0 };
}

const rows: ClientRow[] = [
  row("하늘", "박PM", "제조"),
  row("가람", "이PM", null),
  row("나무", "미배정", "IT"),
];

describe("filterClients", () => {
  it("filters by name substring, case-insensitive", () => {
    expect(filterClients(rows, "나").map((r) => r.name)).toEqual(["나무"]);
  });
  it("returns all rows for empty query", () => {
    expect(filterClients(rows, "  ").map((r) => r.name)).toEqual(["하늘", "가람", "나무"]);
  });
});

describe("sortClients", () => {
  it("sorts by name in Korean order", () => {
    expect(sortClients(rows, "name").map((r) => r.name)).toEqual(["가람", "나무", "하늘"]);
  });
  it("sorts by PM label, 미배정 last", () => {
    expect(sortClients(rows, "pm").map((r) => r.pmLabel)).toEqual(["박PM", "이PM", "미배정"]);
  });
  it("sorts by industry, null (미분류) last, tie-broken by name", () => {
    const r = sortClients(rows, "industry");
    expect(r.map((x) => x.industry)).toEqual(["IT", "제조", null]);
  });
  it("does not mutate the input array", () => {
    const before = rows.map((r) => r.name);
    sortClients(rows, "name");
    expect(rows.map((r) => r.name)).toEqual(before);
  });
});

describe("paginate", () => {
  const many: ClientRow[] = Array.from({ length: 23 }, (_, i) => row(`c${i}`, "x", null));
  it("returns 10 per page and correct totalPages", () => {
    const p = paginate(many, 1);
    expect(p.pageRows).toHaveLength(10);
    expect(p.totalPages).toBe(3);
  });
  it("returns the remainder on the last page", () => {
    expect(paginate(many, 3).pageRows).toHaveLength(3);
  });
  it("clamps out-of-range page into range", () => {
    expect(paginate(many, 99).page).toBe(3);
    expect(paginate(many, 0).page).toBe(1);
  });
  it("has one page for an empty list", () => {
    const p = paginate([], 1);
    expect(p.totalPages).toBe(1);
    expect(p.pageRows).toEqual([]);
  });
});
