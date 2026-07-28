-- 법인카드 사용 내역 라인아이템 원장. 항목(item)을 세부 구분 기준으로 삼는다.
CREATE TABLE "CorporateCardExpense" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CorporateCardExpense_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CorporateCardExpense_clientId_year_month_idx" ON "CorporateCardExpense"("clientId", "year", "month");
CREATE INDEX "CorporateCardExpense_item_idx" ON "CorporateCardExpense"("item");

ALTER TABLE "CorporateCardExpense" ADD CONSTRAINT "CorporateCardExpense_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: 관리자·정산담당자는 전체, PM은 담당 고객사(ClientManager) 범위만 (ConsultingExpense 정책과 동일)
ALTER TABLE "CorporateCardExpense" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CorporateCardExpense" FORCE ROW LEVEL SECURITY;
CREATE POLICY corporate_card_expense_rls ON "CorporateCardExpense"
  USING (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (SELECT 1 FROM "ClientManager" cm WHERE cm."clientId" = "CorporateCardExpense"."clientId" AND cm."userId" = current_setting('app.user_id', true))
  )
  WITH CHECK (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (SELECT 1 FROM "ClientManager" cm WHERE cm."clientId" = "CorporateCardExpense"."clientId" AND cm."userId" = current_setting('app.user_id', true))
  );
