import { cookies } from "next/headers";

export const EASYWEL_COOKIE = "easywel_only";

/** 현대이지웰 고객사만 보기 여부. 쿠키 "1"일 때만 On, 기본 Off(전체). */
export async function getEasywelOnly(): Promise<boolean> {
  const store = await cookies();
  return store.get(EASYWEL_COOKIE)?.value === "1";
}
