"use client";

import { FileDropzone } from "@/components/FileDropzone";

// 정산담당자/관리자가 등록된 지급요청을 엑셀로 다운로드해 지급일/지급여부만 채운 뒤
// 재업로드하는 팝업. 실제 파싱·DB 반영은 다음 단계에서 서버 액션을 연결한다 — 이번 단계는 화면만.
export function PaymentRequestExcelUploadModal({ onClose }: { onClose: () => void }) {
  function handleUpload() {
    alert("추후 구현 예정입니다.");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-[14px] bg-[var(--color-surface)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold">⬆ 엑셀 업로드</h2>
          <button type="button" onClick={onClose} className="text-[var(--color-muted)]" aria-label="닫기">✕</button>
        </div>
        <p className="mb-4 text-sm text-[var(--color-muted)]">
          다운로드한 엑셀에 지급일/지급여부만 채워서 업로드하면 해당 값만 반영됩니다.
        </p>

        <FileDropzone name="file" accept=".xlsx,.xls,.csv" hint="지원 확장자: .xlsx, .xls, .csv" />

        <p className="mt-3 rounded bg-[var(--color-hover)] px-3 py-2 text-xs text-[var(--color-muted)]">
          반영 항목: 지급일, 지급여부
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">취소</button>
          <button type="button" onClick={handleUpload} className="rounded bg-[var(--color-primary)] px-5 py-2 text-sm text-white">⬆ 업로드 실행</button>
        </div>
      </div>
    </div>
  );
}
