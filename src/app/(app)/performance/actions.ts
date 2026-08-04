"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { performanceBatchSchema } from "@/lib/validation/schemas";
import { upsertPerformanceBatch } from "@/lib/data/performance";
import { type ActionState, SAVED } from "@/lib/action-state";

export async function savePerformance(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const ctx = getRlsContext(user);

  // 과업별로 count_/amount_ 값을 함께 모은다. 비활성화된 입력은 폼에서 전송되지 않으므로
  // 정상 흐름에서는 과업당 한쪽만 도착한다(반대편은 서버 스키마가 XOR로 백스톱).
  const byTask = new Map<string, { count?: string; amount?: string }>();
  for (const [key, value] of formData.entries()) {
    let taskId: string | null = null;
    let field: "count" | "amount" | null = null;
    if (key.startsWith("count_")) { taskId = key.slice("count_".length); field = "count"; }
    else if (key.startsWith("amount_")) { taskId = key.slice("amount_".length); field = "amount"; }
    if (!taskId || !field) continue;
    const raw = String(value).trim();
    if (raw === "") continue; // 미입력 → 저장 안 함
    const entry = byTask.get(taskId) ?? {};
    entry[field] = raw;
    byTask.set(taskId, entry);
  }
  const rows = [...byTask.entries()].map(([taskId, v]) => ({
    taskId, count: v.count ?? "", amount: v.amount ?? "",
  }));

  const parsed = performanceBatchSchema.safeParse({
    clientId: formData.get("clientId"),
    year: formData.get("year"),
    month: formData.get("month"),
    rows,
  });
  if (!parsed.success) return { ok: false, error: "입력값이 올바르지 않습니다. 과업별로 횟수 또는 금액 중 하나만, 0 이상의 정수로 입력하세요." };

  const result = await upsertPerformanceBatch(ctx, parsed.data);
  if (!result.ok) return result;
  revalidatePath("/performance");
  return SAVED;
}
