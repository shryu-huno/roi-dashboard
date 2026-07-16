"use server";

import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth/session";
import { EASYWEL_COOKIE } from "@/lib/easywel";

// 현대이지웰 고객사만 보기 토글(대시보드 전체 집계에 적용). 쿠키로 저장, 기본 Off.
export async function setEasywelOnlyAction(on: boolean): Promise<void> {
  await requireUser();
  const store = await cookies();
  if (on) {
    store.set(EASYWEL_COOKIE, "1", { path: "/", maxAge: 60 * 60 * 24 * 365 });
  } else {
    store.delete(EASYWEL_COOKIE);
  }
}
