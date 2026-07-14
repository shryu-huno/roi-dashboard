import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasAtLeast, type AppRole } from "@/lib/auth/rbac";

// auth()는 database 세션 전략이라 호출마다 DB를 조회한다.
// layout과 page가 같은 요청에서 각각 requireUser를 호출하므로 요청 단위로 중복 제거.
const getSession = cache(() => auth());

export type SessionUser = {
  id: string;
  role: AppRole | null;
  status: "PENDING" | "ACTIVE" | "INACTIVE";
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
