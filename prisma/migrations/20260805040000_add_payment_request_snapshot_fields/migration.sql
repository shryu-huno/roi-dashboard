-- 3단계 패턴(Payee.accountNumberBidx 작업과 동일): nullable 추가 → 백필 → NOT NULL 확정.
-- 기존 행은 전부 매칭 건(payeeId 보유)이 원칙이므로 연동된 Payee 값으로 백필한다.
-- payeeId가 없는(과거 예외 건) 행은 은행정보를 원래 저장한 적이 없으므로 빈 문자열로 채운다.

ALTER TABLE "PaymentRequest" ADD COLUMN "bankName" TEXT;
ALTER TABLE "PaymentRequest" ADD COLUMN "accountNumberEnc" TEXT;
ALTER TABLE "PaymentRequest" ADD COLUMN "accountHolder" TEXT;

UPDATE "PaymentRequest" pr
SET "bankName" = p."bankName", "accountNumberEnc" = p."accountNumberEnc", "accountHolder" = p."accountHolder"
FROM "Payee" p
WHERE pr."payeeId" = p."id";

UPDATE "PaymentRequest"
SET "bankName" = '', "accountNumberEnc" = '', "accountHolder" = ''
WHERE "bankName" IS NULL;

ALTER TABLE "PaymentRequest" ALTER COLUMN "bankName" SET NOT NULL;
ALTER TABLE "PaymentRequest" ALTER COLUMN "accountNumberEnc" SET NOT NULL;
ALTER TABLE "PaymentRequest" ALTER COLUMN "accountHolder" SET NOT NULL;
