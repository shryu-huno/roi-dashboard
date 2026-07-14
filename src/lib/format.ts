/** 입력 문자열에서 숫자만 남긴다. */
export function digitsOnly(s: string): string {
  return s.replace(/[^\d]/g, "");
}

/** 숫자/문자열을 천단위 콤마 문자열로. 빈 값은 "". (예: 1000000 → "1,000,000") */
export function formatThousands(v: string | number | null | undefined): string {
  const d = digitsOnly(String(v ?? ""));
  return d === "" ? "" : Number(d).toLocaleString("ko-KR");
}

/** 부호(-) 허용, 숫자만 남긴다. 맨 앞의 - 하나만 인정한다. (예: "-1,000원" → "-1000") */
export function signedDigitsOnly(s: string): string {
  const neg = s.trimStart().startsWith("-");
  return (neg ? "-" : "") + s.replace(/[^\d]/g, "");
}

/** 부호 허용 천단위 콤마. 음수 단가(마이너스 조정) 표시용. (예: -1000000 → "-1,000,000") */
export function formatThousandsSigned(v: string | number | null | undefined): string {
  const raw = signedDigitsOnly(String(v ?? ""));
  const neg = raw.startsWith("-");
  const d = raw.replace(/[^\d]/g, "");
  if (d === "") return neg ? "-" : "";
  return (neg ? "-" : "") + Number(d).toLocaleString("ko-KR");
}

/** 정수 원화. null/undefined → "—". (예: 1000000 → "1,000,000원") */
export function formatWon(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `${v.toLocaleString("ko-KR")}원`;
}

/** 비율(0~1) → 소수1자리 퍼센트. null/undefined → "—". (예: 0.7 → "70.0%") */
export function formatPercent(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `${(v * 100).toFixed(1)}%`;
}
