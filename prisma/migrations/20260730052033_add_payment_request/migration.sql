-- CreateEnum
CREATE TYPE "PaymentRequestEntity" AS ENUM ('HUNO', 'HUNO_INC');

-- CreateEnum
CREATE TYPE "PaymentRequestStatus" AS ENUM ('PREPARING', 'COMPLETED');

-- CreateTable
CREATE TABLE "PaymentRequest" (
    "id" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requesterId" TEXT NOT NULL,
    "entity" "PaymentRequestEntity" NOT NULL,
    "clientId" TEXT NOT NULL,
    "payeeId" TEXT,
    "bizName" TEXT NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "transportFee" INTEGER NOT NULL,
    "materialFee" INTEGER NOT NULL,
    "count" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "taxType" "TaxType" NOT NULL,
    "memo" TEXT NOT NULL,
    "payDate" TIMESTAMP(3),
    "status" "PaymentRequestStatus" NOT NULL DEFAULT 'PREPARING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentRequest_clientId_idx" ON "PaymentRequest"("clientId");

-- CreateIndex
CREATE INDEX "PaymentRequest_requesterId_idx" ON "PaymentRequest"("requesterId");

-- CreateIndex
CREATE INDEX "PaymentRequest_status_idx" ON "PaymentRequest"("status");

-- CreateIndex
CREATE INDEX "PaymentRequest_payeeId_idx" ON "PaymentRequest"("payeeId");

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_payeeId_fkey" FOREIGN KEY ("payeeId") REFERENCES "Payee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS: 고객사 단위 스코프(Client/Expense와 동일 패턴). ADMIN·SETTLEMENT는 전체,
-- PM은 ClientManager로 담당하는 고객사의 건만 조회/등록 가능. PM의 수정(UPDATE, 소프트삭제
-- 포함)은 본인이 신청한 건으로 한정한다(신청완료 이후 잠금 등 세부 규칙은 앱 레이어가 담당).
ALTER TABLE "PaymentRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentRequest" FORCE ROW LEVEL SECURITY;

CREATE POLICY payment_request_select ON "PaymentRequest"
  FOR SELECT
  USING (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (
      SELECT 1 FROM "ClientManager" cm
      WHERE cm."clientId" = "PaymentRequest"."clientId"
        AND cm."userId" = current_setting('app.user_id', true)
    )
  );

CREATE POLICY payment_request_write_admin ON "PaymentRequest"
  FOR ALL
  USING (current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT'))
  WITH CHECK (current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT'));

CREATE POLICY payment_request_insert_pm ON "PaymentRequest"
  FOR INSERT
  WITH CHECK (
    current_setting('app.user_role', true) = 'PM'
    AND EXISTS (
      SELECT 1 FROM "ClientManager" cm
      WHERE cm."clientId" = "PaymentRequest"."clientId"
        AND cm."userId" = current_setting('app.user_id', true)
    )
  );

CREATE POLICY payment_request_update_pm ON "PaymentRequest"
  FOR UPDATE
  USING (
    current_setting('app.user_role', true) = 'PM'
    AND "requesterId" = current_setting('app.user_id', true)
  )
  WITH CHECK (
    current_setting('app.user_role', true) = 'PM'
    AND "requesterId" = current_setting('app.user_id', true)
  );
