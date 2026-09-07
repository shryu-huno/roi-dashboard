import { cookies } from "next/headers";

/** 부가세율 10%. */
export const VAT_RATE = 0.1;
export const VAT_COOKIE = "include_vat";

/** 부가세 포함 여부. 쿠키 미설정 시 기본 On(true). "0"일 때만 Off. */
export async function getIncludeVat(): Promise<boolean> {
  const store = await cookies();
  return store.get(VAT_COOKIE)?.value !== "0";
}

/** 부가세 포함이면 ×1.1 후 10원 단위 반올림(1의 자리 = 0원), 아니면 원값. */
export function withVat(amount: number, include: boolean): number {
  return include ? Math.round((amount * (1 + VAT_RATE)) / 10) * 10 : amount;
}

/** 과세분(taxable)에만 부가세를 적용하고, 면세분(exempt)은 원값으로 합산한다. */
export function withVatSplit(taxable: number, exempt: number, include: boolean): number {
  return withVat(taxable, include) + exempt;
}

/**
 * 부가세 포함 금액(gross)을 토글에 맞춰 반환한다. 청구/입금(Invoice.amount)은 VAT 포함으로 저장하므로
 * include=true면 그대로, include=false면 ÷1.1 후 10원 단위 반올림(withVat와 대칭).
 */
export function fromGross(gross: number, include: boolean): number {
  return include ? gross : Math.round(gross / (1 + VAT_RATE) / 10) * 10;
}
