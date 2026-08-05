-- CreateTable
CREATE TABLE "PaymentRequestNotice" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "content" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRequestNotice_pkey" PRIMARY KEY ("id")
);

-- RLS: SELECT는 전원 허용(지급요청 탭 자체가 ADMIN/SETTLEMENT/PM 전용이라 별도 스코프 불필요).
-- INSERT/UPDATE는 ADMIN/SETTLEMENT만(PaymentRequest의 payment_request_write_admin과 동일 패턴).
-- DELETE 정책 없음 — 항상 upsert로 빈 문자열까지 포함해 갱신한다.
ALTER TABLE "PaymentRequestNotice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentRequestNotice" FORCE ROW LEVEL SECURITY;

CREATE POLICY payment_request_notice_select ON "PaymentRequestNotice"
  FOR SELECT
  USING (true);

CREATE POLICY payment_request_notice_write_admin ON "PaymentRequestNotice"
  FOR ALL
  USING (current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT'))
  WITH CHECK (current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT'));
