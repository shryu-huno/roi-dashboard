"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { billingSchema, depositSchema } from "@/lib/validation/schemas";
import { upsertBilling, upsertDeposit } from "@/lib/data/billing";
import { type ActionState, SAVED } from "@/lib/action-state";

export async function saveBilling(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);
  const parsed = billingSchema.safeParse({
    clientId: formData.get("clientId"),
    year: formData.get("year"),
    month: formData.get("month"),
    amount: formData.get("amount"),
  });
  if (!parsed.success) return { ok: false, error: "청구액은 0 이상의 정수여야 합니다." };
  const result = await upsertBilling(ctx, parsed.data);
  if (!result.ok) return result;
  revalidatePath("/billing");
  return SAVED;
}

export async function saveDeposit(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);
  const parsed = depositSchema.safeParse({
    clientId: formData.get("clientId"),
    year: formData.get("year"),
    month: formData.get("month"),
    amount: formData.get("amount"),
  });
  if (!parsed.success) return { ok: false, error: "입금액은 0 이상의 정수여야 합니다." };
  const result = await upsertDeposit(ctx, parsed.data);
  if (!result.ok) return result;
  revalidatePath("/billing");
  return SAVED;
}
