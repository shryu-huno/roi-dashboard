// src/app/(app)/expenses/PaymentRequestNoticeBanner.tsx
// 공지사항 CRUD(정산담당자/관리자 작성)는 다음 단계 스펙에서 구현. 이번 단계는 자리만 배치.
export function PaymentRequestNoticeBanner() {
  return (
    <div className="mb-4 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-hover)] px-4 py-3 text-sm text-[var(--color-muted)]">
      📢 등록된 공지가 없습니다.
    </div>
  );
}
