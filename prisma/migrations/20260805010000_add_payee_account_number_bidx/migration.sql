-- accountNumberBidx는 앱 계층(AES-GCM 복호화 + HMAC)에서만 계산 가능해 SQL로 백필할 수 없다.
-- 1단계: nullable로 컬럼만 추가 → 2단계: scripts/backfill-payee-account-bidx.ts로 기존 행 백필 →
-- 3단계: 20260805020000_payee_account_number_bidx_not_null 마이그레이션으로 NOT NULL 확정.
ALTER TABLE "Payee" ADD COLUMN "accountNumberBidx" TEXT;

-- CreateIndex
CREATE INDEX "Payee_accountNumberBidx_idx" ON "Payee"("accountNumberBidx");
