import { describe, it, expect } from "vitest";
import { csvFromRows, parseCsv } from "@/lib/csv";

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

describe("parseCsv", () => {
  it("헤더+행을 2차원 배열로 파싱", () => {
    expect(parseCsv("이름,연락처\r\n홍길동,01012345678")).toEqual([
      ["이름", "연락처"],
      ["홍길동", "01012345678"],
    ]);
  });
  it("따옴표로 감싼 셀의 콤마/따옴표 이스케이프 처리", () => {
    expect(parseCsv('"a,b","he said ""hi"""')).toEqual([["a,b", 'he said "hi"']]);
  });
  it("BOM과 LF 줄바꿈, 빈 입력 처리", () => {
    expect(parseCsv("﻿x\ny")).toEqual([["x"], ["y"]]);
    expect(parseCsv("")).toEqual([]);
  });
});
