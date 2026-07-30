"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { expenseSchema, paymentRequestRowSchema } from "@/lib/validation/schemas";
import { upsertExpense } from "@/lib/data/expenses";
import { createPaymentRequestsBulk } from "@/lib/data/payment-requests";
import type { PaymentRequestCreateInput } from "@/lib/payment-request-validation";
import { type ActionState, SAVED } from "@/lib/action-state";

export async function saveExpense(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
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
  if (!result.ok) return result;
  revalidatePath("/expenses");
  return SAVED;
}

// PM 지급요청 등록 화면(행 편집기)의 여러 행을 한 번에 저장한다. FormData가 아니라 배열을 직접
// 받는 이유는 이 화면이 동적 행 개수를 다루는 표 편집기라 FormData로 표현하기 부적합하기 때문이다
// (다른 액션들과의 시그니처 차이는 이 화면의 특수성 때문). clientId RLS 위반(담당하지 않는
// 고객사)은 예상 가능한 보안 경계라 createPaymentRequestsBulk가 던지므로 여기서 잡아 일반
// 사용자 메시지로 바꾼다.
export async function createPaymentRequests(rows: PaymentRequestCreateInput[]): Promise<ActionState> {
  const user = await requireUser();
  if (user.role !== "PM") return { ok: false, error: "권한이 없습니다." };

  const parsed = z.array(paymentRequestRowSchema).min(1).safeParse(rows);
  if (!parsed.success) return { ok: false, error: "입력값이 올바르지 않습니다." };

  const ctx = getRlsContext(user);
  try {
    const result = await createPaymentRequestsBulk(ctx, user.id, parsed.data);
    if (!result.ok) return result;
  } catch {
    return { ok: false, error: "저장 중 오류가 발생했습니다. 담당 고객사와 사업자 선택을 다시 확인해 주세요." };
  }

  revalidatePath("/expenses");
  return SAVED;
}
