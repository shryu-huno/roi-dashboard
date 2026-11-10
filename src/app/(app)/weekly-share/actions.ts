"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { canWriteWeeklyShare } from "@/lib/auth/rbac";
import { weeklySubmitSchema } from "@/lib/validation/schemas";
import { submitWeekly, type WeeklySubmitResult } from "@/lib/data/weekly-share";

export type SubmitOutcome = { ok: true; result: WeeklySubmitResult } | { ok: false; error: string };

// 주간 공유 제출 한 번으로 고객사 카드와 기타 업무를 저장한다. 임시저장 없음.
// 쓰기 권한(PM·파트장, 그 고객사의 담당 PM)은 DB RLS가 최종 강제하고, 여기서는 역할과 입력 형식을 먼저 거른다.
export async function submitWeeklyAction(payload: unknown): Promise<SubmitOutcome> {
  const user = await requireUser();
  if (!canWriteWeeklyShare(user.role)) return { ok: false, error: "주간 공유를 작성할 수 있는 권한이 없습니다." };

  const parsed = weeklySubmitSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: "입력값이 올바르지 않습니다." };

  const result = await submitWeekly(getRlsContext(user), parsed.data);
  revalidatePath("/weekly-share");
  return { ok: true, result };
}
