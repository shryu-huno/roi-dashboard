-- 상담비 라인아이템 원장. 상담분야(field)를 세부 항목 구분 기준으로 삼는다.
CREATE TABLE "ConsultingExpense" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "consultType" TEXT,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsultingExpense_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConsultingExpense_clientId_year_month_idx" ON "ConsultingExpense"("clientId", "year", "month");
CREATE INDEX "ConsultingExpense_field_idx" ON "ConsultingExpense"("field");

ALTER TABLE "ConsultingExpense" ADD CONSTRAINT "ConsultingExpense_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: 관리자·정산담당자는 전체, PM은 담당 고객사(ClientManager) 범위만 (Expense 정책과 동일)
ALTER TABLE "ConsultingExpense" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConsultingExpense" FORCE ROW LEVEL SECURITY;
CREATE POLICY consulting_expense_rls ON "ConsultingExpense"
  USING (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (SELECT 1 FROM "ClientManager" cm WHERE cm."clientId" = "ConsultingExpense"."clientId" AND cm."userId" = current_setting('app.user_id', true))
  )
  WITH CHECK (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (SELECT 1 FROM "ClientManager" cm WHERE cm."clientId" = "ConsultingExpense"."clientId" AND cm."userId" = current_setting('app.user_id', true))
  );
