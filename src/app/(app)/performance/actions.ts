"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { performanceBatchSchema } from "@/lib/validation/schemas";
import { upsertPerformanceBatch } from "@/lib/data/performance";
import type { ActionState } from "@/lib/action-state";

export async function savePerformance(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const ctx = getRlsContext(user);

  const rows: { taskId: string; count: string }[] = [];
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("count_")) {
      const raw = String(value).trim();
      if (raw === "") continue; // 미입력 → 저장 안 함
      rows.push({ taskId: key.slice("count_".length), count: raw });
    }
  }

  const parsed = performanceBatchSchema.safeParse({
    clientId: formData.get("clientId"),
    year: formData.get("year"),
    month: formData.get("month"),
    rows,
  });
  if (!parsed.success) return { ok: false, error: "입력값이 올바르지 않습니다. 횟수는 0 이상의 정수여야 합니다." };

  const result = await upsertPerformanceBatch(ctx, parsed.data);
  if (result.ok) revalidatePath("/performance");
  return result;
}
