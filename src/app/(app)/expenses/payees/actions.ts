"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { createPayeesBulk } from "@/lib/data/payees";
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
  } catch {
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

  const { created, skipped } = await createPayeesBulk(ctx, inputs);
  revalidatePath("/expenses");

  const parts = [`${created}건 등록`];
  if (skipped) parts.push(`${skipped}건 중복 스킵`);
  return { ok: true, message: parts.join(" · "), created, skipped, rowErrors: errors };
}
