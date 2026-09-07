"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { invoiceSchema, paymentConfirmSchema } from "@/lib/validation/schemas";
import { createInvoice, updateInvoice, deleteInvoice, markInvoicePaid } from "@/lib/data/invoices";
import { type ActionState, SAVED } from "@/lib/action-state";

export async function createInvoiceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const ctx = getRlsContext(user);
  const parsed = invoiceSchema.safeParse({
    clientId: formData.get("clientId"),
    amount: formData.get("amount"),
    issueDate: formData.get("issueDate"),
    note: formData.get("note"),
  });
  if (!parsed.success) return { ok: false, error: "고객사·청구금액(0 이상)·발행일자를 확인하세요." };
  const result = await createInvoice(ctx, parsed.data);
  if (!result.ok) return result;
  revalidatePath("/billing");
  return SAVED;
}

export async function updateInvoiceAction(id: string, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const ctx = getRlsContext(user);
  const parsed = invoiceSchema.safeParse({
    clientId: formData.get("clientId"),
    amount: formData.get("amount"),
    issueDate: formData.get("issueDate"),
    note: formData.get("note"),
  });
  if (!parsed.success) return { ok: false, error: "고객사·청구금액(0 이상)·발행일자를 확인하세요." };
  const result = await updateInvoice(ctx, id, parsed.data);
  if (!result.ok) return result;
  revalidatePath("/billing");
  return SAVED;
}

export async function deleteInvoiceAction(id: string): Promise<ActionState> {
  const user = await requireUser();
  const ctx = getRlsContext(user);
  const result = await deleteInvoice(ctx, id);
  if (!result.ok) return result;
  revalidatePath("/billing");
  return SAVED;
}

export async function confirmPaymentAction(id: string, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const ctx = getRlsContext(user);
  const parsed = paymentConfirmSchema.safeParse({ paidDate: formData.get("paidDate") });
  if (!parsed.success) return { ok: false, error: "입금일자를 YYYY-MM-DD 형식으로 입력하세요." };
  const result = await markInvoicePaid(ctx, id, parsed.data.paidDate);
  if (!result.ok) return result;
  revalidatePath("/billing");
  return SAVED;
}
