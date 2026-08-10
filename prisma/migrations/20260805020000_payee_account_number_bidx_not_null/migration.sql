-- scripts/backfill-payee-account-bidx.ts로 기존 행을 전부 백필한 뒤에만 적용해야 한다.
ALTER TABLE "Payee" ALTER COLUMN "accountNumberBidx" SET NOT NULL;
