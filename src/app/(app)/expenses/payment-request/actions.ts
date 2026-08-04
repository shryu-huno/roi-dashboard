"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import {
  updatePaymentRequestsBulk, updatePaymentRequest, updatePaymentRequestPmFields,
  updatePaymentRequestsByIds, softDeletePaymentRequests,
} from "@/lib/data/payment-requests";
import { buildPaymentRequestUpdatesFromRows } from "@/lib/data/payment-request-upload";
import { parseXlsxToRows } from "../payees/xlsx";
import {
  paymentRequestUpdateSchema, paymentRequestUpdatePmSchema, paymentRequestBulkUpdateSchema,
} from "@/lib/validation/schemas";
import { SAVED, type ActionState } from "@/lib/action-state";
import type { PaymentRequestUploadState } from "./upload-state";

export async function uploadPaymentRequestUpdatesAction(
  _prev: PaymentRequestUploadState,
  formData: FormData,
): Promise<PaymentRequestUploadState> {
  const user = await requireRole("SETTLEMENT"); // ADMIN도 랭크상 통과
  const ctx = getRlsContext(user);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "파일을 선택하세요." };
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return { ok: false, error: "지원하지 않는 형식입니다 (.xlsx만 가능)." };
  }

  let rows: string[][];
  try {
    rows = await parseXlsxToRows(await file.arrayBuffer());
  } catch (e) {
    console.error("[payment-request upload] 파일 읽기 실패:", e);
    return { ok: false, error: "파일을 읽을 수 없습니다. 양식을 확인하세요." };
  }

  const { updates, errors } = buildPaymentRequestUpdatesFromRows(rows);
  if (updates.length === 0) {
    return {
      ok: false,
      error: errors.length ? "반영할 유효한 행이 없습니다." : "반영할 데이터가 없습니다.",
      rowErrors: errors,
    };
  }

  let result: { updated: number; notFoundSeqNos: number[] };
  try {
    result = await updatePaymentRequestsBulk(ctx, updates);
  } catch (e) {
    console.error("[payment-request upload] 반영 실패:", e);
    return { ok: false, error: "반영 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.", rowErrors: errors };
  }

  const rowBySeqNo = new Map(updates.map((u) => [u.seqNo, u.row]));
  const notFoundErrors = result.notFoundSeqNos.map((seqNo) => ({
    row: rowBySeqNo.get(seqNo) ?? 0,
    message: `No ${seqNo}에 해당하는 지급요청을 찾을 수 없습니다.`,
  }));
  revalidatePath("/expenses");

  return {
    ok: true,
    message: `${result.updated}건 반영`,
    updated: result.updated,
    rowErrors: [...errors, ...notFoundErrors],
  };
}

export async function updatePaymentRequestAction(id: string, formData: FormData): Promise<ActionState> {
  const user = await requireRole("SETTLEMENT"); // ADMIN도 랭크상 통과
  const ctx = getRlsContext(user);

  const parsed = paymentRequestUpdateSchema.safeParse({
    entity: formData.get("entity"),
    clientId: formData.get("clientId"),
    payeeId: formData.get("payeeId"),
    payDate: formData.get("payDate"),
    status: formData.get("status"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };

  try {
    const result = await updatePaymentRequest(ctx, id, parsed.data);
    if (!result.ok) return result;
  } catch (e) {
    console.error("[payment-request update] 수정 실패:", e);
    return { ok: false, error: "수정 중 오류가 발생했습니다. 잠시 후 다시 시도하세요." };
  }

  revalidatePath("/expenses");
  return SAVED;
}

export async function updatePaymentRequestPmAction(id: string, formData: FormData): Promise<ActionState> {
  const user = await requireRole("PM");
  const ctx = getRlsContext(user);

  const parsed = paymentRequestUpdatePmSchema.safeParse({
    entity: formData.get("entity"),
    clientId: formData.get("clientId"),
    payeeId: formData.get("payeeId"),
    unitPrice: formData.get("unitPrice"),
    transportFee: formData.get("transportFee"),
    materialFee: formData.get("materialFee"),
    count: formData.get("count"),
    memo: formData.get("memo"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };

  try {
    const result = await updatePaymentRequestPmFields(ctx, id, parsed.data);
    if (!result.ok) return result;
  } catch (e) {
    console.error("[payment-request update-pm] 수정 실패:", e);
    return { ok: false, error: "수정 중 오류가 발생했습니다. 잠시 후 다시 시도하세요." };
  }

  revalidatePath("/expenses");
  return SAVED;
}

export async function bulkUpdatePaymentRequestsAction(ids: string[], formData: FormData): Promise<ActionState> {
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);

  const parsed = paymentRequestBulkUpdateSchema.safeParse({
    payDate: formData.get("payDate"),
    status: formData.get("status"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };

  try {
    const result = await updatePaymentRequestsByIds(ctx, ids, parsed.data);
    if (!result.ok) return result;
  } catch (e) {
    console.error("[payment-request bulk-update] 수정 실패:", e);
    return { ok: false, error: "수정 중 오류가 발생했습니다. 잠시 후 다시 시도하세요." };
  }

  revalidatePath("/expenses");
  return SAVED;
}

export async function deletePaymentRequestsAction(ids: string[]): Promise<ActionState> {
  const user = await requireRole("PM"); // ADMIN/SETTLEMENT도 랭크상 통과
  const ctx = getRlsContext(user);

  try {
    const result = await softDeletePaymentRequests(
      ctx, ids,
      user.role === "PM" ? { statusIn: ["PREPARING"] } : undefined,
    );
    if (!result.ok) return result;
  } catch (e) {
    console.error("[payment-request delete] 삭제 실패:", e);
    return { ok: false, error: "삭제 중 오류가 발생했습니다. 잠시 후 다시 시도하세요." };
  }

  revalidatePath("/expenses");
  return SAVED;
}
