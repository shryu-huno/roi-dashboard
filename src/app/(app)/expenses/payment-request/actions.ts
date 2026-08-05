"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import {
  updatePaymentRequestsBulk, updatePaymentRequest, updatePaymentRequestPmFields,
  updatePaymentRequestsByIds, softDeletePaymentRequests, createPaymentRequestsFromUpload,
} from "@/lib/data/payment-requests";
import { upsertPaymentRequestNotice } from "@/lib/data/payment-request-notice";
import { buildPaymentRequestUpdatesFromRows } from "@/lib/data/payment-request-upload";
import { buildPaymentRequestRegistrationRowsFromXlsx } from "@/lib/data/payment-request-registration-upload";
import { parseXlsxToRows } from "../payees/xlsx";
import {
  paymentRequestUpdateSchema, paymentRequestUpdatePmSchema, paymentRequestBulkUpdateSchema,
  paymentRequestNoticeSchema,
} from "@/lib/validation/schemas";
import { SAVED, type ActionState } from "@/lib/action-state";
import type { PaymentRequestUploadState } from "./upload-state";
import type { PaymentRequestCreateUploadState } from "./create-upload-state";

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

export async function updatePaymentRequestNoticeAction(formData: FormData): Promise<ActionState> {
  const user = await requireRole("SETTLEMENT"); // ADMIN도 랭크상 통과
  const ctx = getRlsContext(user);

  const parsed = paymentRequestNoticeSchema.safeParse({ content: formData.get("content") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };

  try {
    const result = await upsertPaymentRequestNotice(ctx, parsed.data.content);
    if (!result.ok) return result;
  } catch (e) {
    console.error("[payment-request notice] 저장 실패:", e);
    return { ok: false, error: "저장 중 오류가 발생했습니다. 잠시 후 다시 시도하세요." };
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

// PM 엑셀 대량 등록. 정산담당자 재업로드(uploadPaymentRequestUpdatesAction)와 달리 PM 전용이고,
// all-or-nothing으로 저장한다 — 형식 오류든 매칭 오류든 하나라도 있으면 아무것도 저장하지 않는다.
export async function uploadPaymentRequestCreatesAction(
  _prev: PaymentRequestCreateUploadState,
  formData: FormData,
): Promise<PaymentRequestCreateUploadState> {
  const user = await requireRole("PM");
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
    console.error("[payment-request create-upload] 파일 읽기 실패:", e);
    return { ok: false, error: "파일을 읽을 수 없습니다. 양식을 확인하세요." };
  }

  const { rows: parsedRows, errors: parseErrors } = buildPaymentRequestRegistrationRowsFromXlsx(rows);
  if (parseErrors.length > 0) {
    return { ok: false, error: "입력값을 확인해 주세요.", rowErrors: parseErrors };
  }
  if (parsedRows.length === 0) {
    return { ok: false, error: "등록할 데이터가 없습니다." };
  }

  let result: Awaited<ReturnType<typeof createPaymentRequestsFromUpload>>;
  try {
    result = await createPaymentRequestsFromUpload(ctx, user.id, parsedRows);
  } catch (e) {
    console.error("[payment-request create-upload] 등록 실패:", e);
    return { ok: false, error: "등록 중 오류가 발생했습니다. 잠시 후 다시 시도하세요." };
  }
  if (!result.ok) {
    return { ok: false, error: "입력값을 확인해 주세요.", rowErrors: result.errors };
  }

  revalidatePath("/expenses");
  return { ok: true, message: `${result.created}건 등록`, created: result.created };
}
