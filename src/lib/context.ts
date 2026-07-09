import type { RlsContext } from "@/lib/rls";
import type { AppRole } from "@/lib/auth/rbac";

/** 세션 사용자 → RLS 컨텍스트. 승인된 사용자는 항상 역할을 가진다. */
export function getRlsContext(user: { id: string; role: AppRole | null }): RlsContext {
  if (!user.role) throw new Error("역할이 지정되지 않은 사용자입니다.");
  return { userId: user.id, role: user.role };
}
