import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasAtLeast, type AppRole } from "@/lib/auth/rbac";

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
  const session = await auth();
  const user = (session?.user ?? null) as SessionUser | null;
  const result = resolveGuard(user, null);
  if ("redirect" in result) redirect(result.redirect);
  return user!;
}

export async function requireRole(required: AppRole): Promise<SessionUser> {
  const session = await auth();
  const user = (session?.user ?? null) as SessionUser | null;
  const result = resolveGuard(user, required);
  if ("redirect" in result) redirect(result.redirect);
  return user!;
}
