"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { expenseSchema } from "@/lib/validation/schemas";
import { upsertExpense } from "@/lib/data/expenses";
import type { ActionState } from "@/lib/action-state";

export async function saveExpense(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);
  const parsed = expenseSchema.safeParse({
    clientId: formData.get("clientId"),
    year: formData.get("year"),
    month: formData.get("month"),
    category: formData.get("category"),
    amount: formData.get("amount"),
    memo: formData.get("memo"),
  });
  if (!parsed.success) return { ok: false, error: "입력값이 올바르지 않습니다. 금액은 0 이상의 정수여야 합니다." };
  const result = await upsertExpense(ctx, parsed.data);
  if (result.ok) revalidatePath("/expenses");
  return result;
}
