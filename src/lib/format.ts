/** 입력 문자열에서 숫자만 남긴다. */
export function digitsOnly(s: string): string {
  return s.replace(/[^\d]/g, "");
}

/** 숫자/문자열을 천단위 콤마 문자열로. 빈 값은 "". (예: 1000000 → "1,000,000") */
export function formatThousands(v: string | number | null | undefined): string {
  const d = digitsOnly(String(v ?? ""));
  return d === "" ? "" : Number(d).toLocaleString("ko-KR");
}
