"use server";

import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth/session";
import { EASYWEL_COOKIE } from "@/lib/easywel";
import { BASIS_COOKIE } from "@/lib/basis";

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

// 집계 기준 토글(프로젝트 기준 vs 회계연도 기준). 쿠키로 저장, 기본 프로젝트 기준(Off).
export async function setFiscalBasisAction(on: boolean): Promise<void> {
  await requireUser();
  const store = await cookies();
  if (on) {
    store.set(BASIS_COOKIE, "1", { path: "/", maxAge: 60 * 60 * 24 * 365 });
  } else {
    store.delete(BASIS_COOKIE);
  }
}
