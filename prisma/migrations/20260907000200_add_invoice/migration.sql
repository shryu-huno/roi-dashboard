-- 계산서 단위 개별 청구 기록(Invoice) 도입.
-- 기존 월별 청구/입금(MonthlyBilling/MonthlyDeposit)을 대체한다. 대시보드 청구/입금 지표는
-- Invoice에서 산출한다(청구=issueDate 월 합계, 입금=paidDate 월 합계).
-- 금액은 VAT 포함(gross)으로 저장한다.
--
-- 마이그레이션은 DIRECT_URL(postgres 소유자)로 적용되지만, Invoice는 FORCE ROW LEVEL SECURITY라
-- 소유자도 정책을 우회하지 못한다. 따라서 아래 백필 SELECT/INSERT가 통과하도록 앱 컨텍스트를 주입한다
-- (전체 열람 역할 = SUPER_ADMIN). SET LOCAL 성격(트랜잭션 한정)이라 마이그레이션 종료 시 사라진다.

-- 0) 백필용 앱 컨텍스트 주입 -------------------------------------------------
SELECT set_config('app.user_role', 'SUPER_ADMIN', true), set_config('app.user_id', 'migration', true);

-- 1) 테이블 + 인덱스 + FK -----------------------------------------------------
CREATE TABLE "Invoice" (
  "id"        TEXT NOT NULL,
  "clientId"  TEXT NOT NULL,
  "amount"    INTEGER NOT NULL,
  "issueDate" TIMESTAMP(3) NOT NULL,
  "note"      TEXT,
  "paidDate"  TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Invoice_clientId_idx"  ON "Invoice"("clientId");
CREATE INDEX "Invoice_issueDate_idx" ON "Invoice"("issueDate");
CREATE INDEX "Invoice_paidDate_idx"  ON "Invoice"("paidDate");
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2) RLS: 직접 clientId 보유 테이블 → app_can_see_client 헬퍼(billing_rls 패턴) ----
--    테이블 GRANT는 supabase-roi-app-role.sql의 ALTER DEFAULT PRIVILEGES가 자동 부여.
ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invoice" FORCE ROW LEVEL SECURITY;
CREATE POLICY invoice_rls ON "Invoice"
  USING (app_can_see_client("Invoice"."clientId"))
  WITH CHECK (app_can_see_client("Invoice"."clientId"));

-- 3) 데이터 이관: 기존 월별 청구/입금 → 계산서 단위 Invoice(근사) ----------------
--    - MonthlyBilling 각 행 → Invoice 1건.
--      구 amount는 VAT 미포함이었으므로 gross로 환산(×1.1, 10원 단위 반올림 = 앱 withVat 규칙과 동일).
--      issueDate = 해당 연·월 1일.
--    - 같은 (clientId, year, month)에 MonthlyDeposit이 있으면 입금 완료로 보고 paidDate = 연·월 1일.
--      (월 합계 기반이라 계산서 단위 정확 매핑은 불가 — 월 단위 근사.)
INSERT INTO "Invoice" ("id", "clientId", "amount", "issueDate", "note", "paidDate", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  b."clientId",
  (round((b."amount" * 1.1) / 10) * 10)::int,
  make_date(b."year", b."month", 1)::timestamp,
  '월별 청구 이관',
  CASE WHEN d."id" IS NOT NULL THEN make_date(b."year", b."month", 1)::timestamp ELSE NULL END,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "MonthlyBilling" b
LEFT JOIN "MonthlyDeposit" d
  ON d."clientId" = b."clientId" AND d."year" = b."year" AND d."month" = b."month";
