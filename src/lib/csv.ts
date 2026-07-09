function escapeCell(cell: string): string {
  if (/[",\n\r]/.test(cell)) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

/** 2차원 문자열 배열 → CSV 문자열 (셀 이스케이프, 행 구분 CRLF). */
export function csvFromRows(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCell).join(",")).join("\r\n");
}
