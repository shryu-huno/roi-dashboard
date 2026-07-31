import { cookies } from "next/headers";

export const BASIS_COOKIE = "fiscal_basis";

/** 집계 기준. 쿠키 "1"일 때만 회계연도 기준, 기본 프로젝트 기준. */
export async function getFiscalBasis(): Promise<boolean> {
  const store = await cookies();
  return store.get(BASIS_COOKIE)?.value === "1";
}
