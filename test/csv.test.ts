import { describe, it, expect } from "vitest";
import { csvFromRows } from "@/lib/csv";

describe("csvFromRows", () => {
  it("joins rows with CRLF and cells with comma", () => {
    expect(csvFromRows([["월", "실적"], ["3", "40000"]])).toBe("월,실적\r\n3,40000");
  });
  it("quotes cells containing comma or quote or newline", () => {
    expect(csvFromRows([['a,b', 'he said "hi"', "line\nbreak"]])).toBe('"a,b","he said ""hi""","line\nbreak"');
  });
  it("handles empty input", () => {
    expect(csvFromRows([])).toBe("");
  });
});
