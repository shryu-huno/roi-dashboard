-- CreateEnum
CREATE TYPE "PayeeType" AS ENUM ('INSTRUCTOR', 'VENDOR');

-- CreateEnum
CREATE TYPE "TaxType" AS ENUM ('TAX_INVOICE', 'TAX_FREE_INVOICE', 'CASH_RECEIPT', 'HANDWRITTEN_INVOICE', 'BUSINESS_INCOME', 'OTHER_INCOME');

-- CreateEnum
CREATE TYPE "PayeeFileType" AS ENUM ('BIZ_CERT', 'BANKBOOK');

-- CreateTable
CREATE TABLE "Payee" (
    "id" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "payeeType" "PayeeType" NOT NULL,
    "bizName" TEXT NOT NULL,
    "bizNumberEnc" TEXT NOT NULL,
    "bizNumberMasked" TEXT NOT NULL,
    "bizNumberBidx" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "phoneNormalized" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountNumberEnc" TEXT NOT NULL,
    "accountNumberMasked" TEXT NOT NULL,
    "accountHolder" TEXT NOT NULL,
    "taxType" "TaxType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayeeAttachment" (
    "id" TEXT NOT NULL,
    "payeeId" TEXT NOT NULL,
    "fileType" "PayeeFileType" NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayeeAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payee_keyId_key" ON "Payee"("keyId");

-- CreateIndex
CREATE UNIQUE INDEX "Payee_bizNumberBidx_key" ON "Payee"("bizNumberBidx");

-- CreateIndex
CREATE INDEX "Payee_phoneNormalized_idx" ON "Payee"("phoneNormalized");

-- CreateIndex
CREATE INDEX "Payee_payeeType_idx" ON "Payee"("payeeType");

-- CreateIndex
CREATE INDEX "PayeeAttachment_payeeId_idx" ON "PayeeAttachment"("payeeId");

-- AddForeignKey
ALTER TABLE "PayeeAttachment" ADD CONSTRAINT "PayeeAttachment_payeeId_fkey" FOREIGN KEY ("payeeId") REFERENCES "Payee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- keyId 채번용 시퀀스 (강사 a###, 업체 b###). 앱이 nextval로 원자적 채번 → 동시/대량 업로드 안전.
CREATE SEQUENCE "payee_key_seq_instructor";
CREATE SEQUENCE "payee_key_seq_vendor";

-- RLS: 전체 공용 원장 — 전 역할 SELECT 허용, 쓰기(INSERT/UPDATE/DELETE)는 ADMIN·SETTLEMENT만.
ALTER TABLE "Payee" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payee" FORCE ROW LEVEL SECURITY;
CREATE POLICY payee_select ON "Payee" FOR SELECT USING (true);
CREATE POLICY payee_write ON "Payee"
  USING (current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT'))
  WITH CHECK (current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT'));

ALTER TABLE "PayeeAttachment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayeeAttachment" FORCE ROW LEVEL SECURITY;
CREATE POLICY payee_attachment_select ON "PayeeAttachment" FOR SELECT USING (true);
CREATE POLICY payee_attachment_write ON "PayeeAttachment"
  USING (current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT'))
  WITH CHECK (current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT'));
