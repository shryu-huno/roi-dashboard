-- 사용자 컨텍스트 헬퍼: 세션 변수에서 값 읽기 (없으면 빈 문자열)
-- app.user_id / app.user_role 는 withRLS 가 트랜잭션마다 set_config 로 주입.

-- Client
ALTER TABLE "Client" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Client" FORCE ROW LEVEL SECURITY;
CREATE POLICY client_rls ON "Client"
  USING (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR "pmId" = current_setting('app.user_id', true)
  )
  WITH CHECK (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR "pmId" = current_setting('app.user_id', true)
  );

-- Task (Client 경유)
ALTER TABLE "Task" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Task" FORCE ROW LEVEL SECURITY;
CREATE POLICY task_rls ON "Task"
  USING (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (
      SELECT 1 FROM "Client" c
      WHERE c.id = "Task"."clientId"
        AND c."pmId" = current_setting('app.user_id', true)
    )
  )
  WITH CHECK (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (
      SELECT 1 FROM "Client" c
      WHERE c.id = "Task"."clientId"
        AND c."pmId" = current_setting('app.user_id', true)
    )
  );

-- MonthlyPerformance (Task → Client 경유)
ALTER TABLE "MonthlyPerformance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MonthlyPerformance" FORCE ROW LEVEL SECURITY;
CREATE POLICY perf_rls ON "MonthlyPerformance"
  USING (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (
      SELECT 1 FROM "Task" t
      JOIN "Client" c ON c.id = t."clientId"
      WHERE t.id = "MonthlyPerformance"."taskId"
        AND c."pmId" = current_setting('app.user_id', true)
    )
  )
  WITH CHECK (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (
      SELECT 1 FROM "Task" t
      JOIN "Client" c ON c.id = t."clientId"
      WHERE t.id = "MonthlyPerformance"."taskId"
        AND c."pmId" = current_setting('app.user_id', true)
    )
  );

-- MonthlyBilling (Client 경유)
ALTER TABLE "MonthlyBilling" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MonthlyBilling" FORCE ROW LEVEL SECURITY;
CREATE POLICY billing_rls ON "MonthlyBilling"
  USING (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (SELECT 1 FROM "Client" c WHERE c.id = "MonthlyBilling"."clientId" AND c."pmId" = current_setting('app.user_id', true))
  )
  WITH CHECK (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (SELECT 1 FROM "Client" c WHERE c.id = "MonthlyBilling"."clientId" AND c."pmId" = current_setting('app.user_id', true))
  );

-- MonthlyDeposit (Client 경유)
ALTER TABLE "MonthlyDeposit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MonthlyDeposit" FORCE ROW LEVEL SECURITY;
CREATE POLICY deposit_rls ON "MonthlyDeposit"
  USING (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (SELECT 1 FROM "Client" c WHERE c.id = "MonthlyDeposit"."clientId" AND c."pmId" = current_setting('app.user_id', true))
  )
  WITH CHECK (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (SELECT 1 FROM "Client" c WHERE c.id = "MonthlyDeposit"."clientId" AND c."pmId" = current_setting('app.user_id', true))
  );

-- Expense (Client 경유)
ALTER TABLE "Expense" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Expense" FORCE ROW LEVEL SECURITY;
CREATE POLICY expense_rls ON "Expense"
  USING (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (SELECT 1 FROM "Client" c WHERE c.id = "Expense"."clientId" AND c."pmId" = current_setting('app.user_id', true))
  )
  WITH CHECK (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (SELECT 1 FROM "Client" c WHERE c.id = "Expense"."clientId" AND c."pmId" = current_setting('app.user_id', true))
  );
