"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { createPayeesBulk, updatePayee, softDeletePayees } from "@/lib/data/payees";
import { PayeeKeyConfigError } from "@/lib/crypto/payee-secret";
import { TAX_TYPE_BY_LABEL } from "@/lib/labels";
import { payeeUpdateSchema } from "@/lib/validation/schemas";
import { SAVED, type ActionState } from "@/lib/action-state";
import { buildPayeeInputsFromCsv, buildPayeeInputsFromRows, type BuildResult } from "./build-inputs";
import { parseXlsxToRows } from "./xlsx";
import type { PayeeUploadState } from "./upload-state";

export async function uploadPayeesAction(
  _prev: PayeeUploadState,
  formData: FormData,
): Promise<PayeeUploadState> {
  const user = await requireRole("SETTLEMENT"); // ADMIN도 랭크상 통과
  const ctx = getRlsContext(user);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "파일을 선택하세요." };
  }

  const name = file.name.toLowerCase();
  let build: BuildResult;
  try {
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      build = buildPayeeInputsFromRows(await parseXlsxToRows(await file.arrayBuffer()));
    } else if (name.endsWith(".csv")) {
      build = buildPayeeInputsFromCsv(await file.text());
    } else {
      return { ok: false, error: "지원하지 않는 형식입니다 (.xlsx, .xls, .csv)." };
    }
  } catch (e) {
    // 암호화 키 누락은 서버 설정 문제다. 파일 탓으로 안내하면 담당자가 멀쩡한 엑셀을 계속 고치게 된다.
    if (e instanceof PayeeKeyConfigError) {
      console.error("[payee upload] 암호화 키 설정 오류:", e.message);
      return { ok: false, error: "서버 설정(암호화 키)이 누락되었습니다. 관리자에게 문의하세요." };
    }
    return { ok: false, error: "파일을 읽을 수 없습니다. 양식을 확인하세요." };
  }

  const { inputs, errors } = build;
  if (inputs.length === 0) {
    return {
      ok: false,
      error: errors.length ? "등록할 유효한 행이 없습니다." : "등록할 데이터가 없습니다.",
      rowErrors: errors,
    };
  }

  let result: { created: number; skipped: number };
  try {
    result = await createPayeesBulk(ctx, inputs);
  } catch (e) {
    // DB 오류로 서버액션이 통째로 throw되면 모달이 깨진다. 상태로 돌려 오류 문구를 띄운다.
    console.error("[payee upload] 등록 실패:", e);
    return { ok: false, error: "등록 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.", rowErrors: errors };
  }
  const { created, skipped } = result;
  revalidatePath("/expenses");

  const parts = [`${created}건 등록`];
  if (skipped) parts.push(`${skipped}건 중복 스킵`);
  return { ok: true, message: parts.join(" · "), created, skipped, rowErrors: errors };
}

export async function updatePayeeAction(id: string, formData: FormData): Promise<ActionState> {
  const user = await requireRole("SETTLEMENT"); // ADMIN도 랭크상 통과
  const ctx = getRlsContext(user);

  const parsed = payeeUpdateSchema.safeParse({
    bizName: formData.get("bizName"),
    bankName: formData.get("bankName"),
    accountNumber: formData.get("accountNumber"),
    accountHolder: formData.get("accountHolder"),
    taxType: formData.get("taxType"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  }
  const d = parsed.data;

  try {
    await updatePayee(ctx, id, {
      bizName: d.bizName,
      bankName: d.bankName,
      accountNumber: d.accountNumber,
      accountHolder: d.accountHolder,
      taxType: TAX_TYPE_BY_LABEL[d.taxType],
    });
  } catch (e) {
    console.error("[payee update] 수정 실패:", e);
    return { ok: false, error: "수정 중 오류가 발생했습니다. 잠시 후 다시 시도하세요." };
  }

  revalidatePath("/expenses");
  return SAVED;
}

export async function deletePayeesAction(ids: string[]): Promise<ActionState> {
  const user = await requireRole("SETTLEMENT"); // ADMIN도 랭크상 통과
  const ctx = getRlsContext(user);

  let result: ActionState;
  try {
    result = await softDeletePayees(ctx, ids);
  } catch (e) {
    console.error("[payee delete] 삭제 실패:", e);
    return { ok: false, error: "삭제 중 오류가 발생했습니다. 잠시 후 다시 시도하세요." };
  }
  if (!result.ok) return result;

  revalidatePath("/expenses");
  return result;
}
