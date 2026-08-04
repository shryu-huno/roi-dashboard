"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { PayeeOption } from "@/lib/data/payees";
import { PaymentRequestRowsTable, newDraftRow, type DraftRow } from "./PaymentRequestRowsTable";
import { createPaymentRequests } from "./actions";
import { validateDraftRows, toPaymentRequestCreateInputs } from "@/lib/payment-request-validation";
import { PaymentRequestExcelRegisterModal } from "./PaymentRequestExcelRegisterModal";

// PM 전용 지급요청 등록 화면. 저장 전 클라이언트에서 행별 필수값을 먼저 검증해 하나라도
// 빠지면 전체 저장을 막고 문제 행을 강조한다. 통과하면 서버 액션을 호출하고, 성공하면
// 지급요청 목록 화면으로 이동한다(서버 액션은 ActionState만 반환하고 redirect는 하지 않음 —
// 화면 이동은 여기서 router.push로 직접 처리해 서버 액션 내 redirect()의 클라이언트 try/catch
// 오작동 위험을 피한다).
export function PaymentRequestNewForm({
  clients,
  payees,
}: {
  clients: { id: string; name: string; businessType: string | null }[];
  payees: PayeeOption[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<DraftRow[]>([newDraftRow()]);
  const [rowErrors, setRowErrors] = useState<ReturnType<typeof validateDraftRows>>(new Map());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadOpen, setIsUploadOpen] = useState(false);

  async function handleSave() {
    if (rows.length === 0) {
      setSaveError("등록할 행을 추가해 주세요.");
      return;
    }
    const errors = validateDraftRows(rows);
    if (errors.size > 0) {
      setRowErrors(errors);
      const firstBadIndex = rows.findIndex((r) => errors.has(r.key));
      setSaveError(`${firstBadIndex + 1}번째 행에 입력하지 않은 항목이 있습니다.`);
      return;
    }
    setRowErrors(new Map());
    setSaveError(null);
    setIsSaving(true);
    const result = await createPaymentRequests(toPaymentRequestCreateInputs(rows));
    if (!result.ok) {
      setSaveError(result.error ?? "저장에 실패했습니다.");
      setIsSaving(false);
      return;
    }
    router.push("/expenses?tab=payment-request");
  }

  return (
    <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">지급요청 등록</h1>
        <div className="flex gap-2">
          <button type="button" onClick={() => setIsUploadOpen(true)} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">
            엑셀 업로드
          </button>
          <Link href="/expenses?tab=payment-request" className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">
            취소
          </Link>
          <button type="button" onClick={handleSave} disabled={isSaving} className="rounded bg-[var(--color-primary)] px-5 py-2 text-sm text-white disabled:opacity-60">
            {isSaving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      {saveError && <p className="mb-3 text-sm text-[var(--color-danger)]">{saveError}</p>}

      <PaymentRequestRowsTable rows={rows} onRowsChange={setRows} clients={clients} payees={payees} rowErrors={rowErrors} />

      <PaymentRequestExcelRegisterModal open={isUploadOpen} onClose={() => setIsUploadOpen(false)} />
    </div>
  );
}
