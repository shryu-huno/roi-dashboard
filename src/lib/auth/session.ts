import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasAtLeast, isAllAccess, type AppRole } from "@/lib/auth/rbac";

// auth()는 database 세션 전략이라 호출마다 DB를 조회한다.
// layout과 page가 같은 요청에서 각각 requireUser를 호출하므로 요청 단위로 중복 제거.
const getSession = cache(() => auth());

export type SessionUser = {
  id: string;
  role: AppRole | null;
  status: "PENDING" | "ACTIVE" | "INACTIVE";
  teamId: string | null;
  email?: string | null;
  name?: string | null;
};

type GuardInput = { status: SessionUser["status"]; role: AppRole | null } | null;
type GuardResult = { ok: true } | { redirect: string };

/** 순수 판정 로직 (테스트 대상). */
export function resolveGuard(user: GuardInput, required: AppRole | null): GuardResult {
  if (!user) return { redirect: "/login" };
  if (user.status !== "ACTIVE") return { redirect: "/pending" };
  if (required && !hasAtLeast(user.role, required)) return { redirect: "/" };
  return { ok: true };
}

export async function requireUser(): Promise<SessionUser> {
  const session = await getSession();
  const user = (session?.user ?? null) as SessionUser | null;
  const result = resolveGuard(user, null);
  if ("redirect" in result) redirect(result.redirect);
  return user!;
}

export async function requireRole(required: AppRole): Promise<SessionUser> {
  const session = await getSession();
  const user = (session?.user ?? null) as SessionUser | null;
  const result = resolveGuard(user, required);
  if ("redirect" in result) redirect(result.redirect);
  return user!;
}

/**
 * "전체 접근"(최고관리자·정산담당자) 게이트. 정산 전용 기능은 순위(hasAtLeast)로 판정하면
 * 팀 관리자(ADMIN, 순위 3 ≥ SETTLEMENT 2)가 통과해버리므로, 순위가 아니라 isAllAccess로 막는다.
 */
export async function requireAllAccess(): Promise<SessionUser> {
  const session = await getSession();
  const user = (session?.user ?? null) as SessionUser | null;
  if (!user) redirect("/login");
  if (user!.status !== "ACTIVE") redirect("/pending");
  if (!isAllAccess(user!.role)) redirect("/");
  return user!;
}
