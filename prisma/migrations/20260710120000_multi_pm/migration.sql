-- 담당 PM 다대다 전환: Client.pmId(1:N) → ClientManager(N:M)

-- 1) 조인 테이블 생성
CREATE TABLE "ClientManager" (
  "clientId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  CONSTRAINT "ClientManager_pkey" PRIMARY KEY ("clientId", "userId")
);
CREATE INDEX "ClientManager_userId_idx" ON "ClientManager"("userId");
ALTER TABLE "ClientManager" ADD CONSTRAINT "ClientManager_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientManager" ADD CONSTRAINT "ClientManager_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2) 기존 단일 담당(pmId) 데이터 이관
INSERT INTO "ClientManager" ("clientId", "userId")
SELECT "id", "pmId" FROM "Client" WHERE "pmId" IS NOT NULL;

-- 3) 기존 정책 제거(모두 Client.pmId에 의존 → 컬럼 삭제 전에 먼저 DROP)
DROP POLICY client_rls ON "Client";
DROP POLICY task_rls ON "Task";
DROP POLICY perf_rls ON "MonthlyPerformance";
DROP POLICY billing_rls ON "MonthlyBilling";
DROP POLICY deposit_rls ON "MonthlyDeposit";
DROP POLICY expense_rls ON "Expense";

-- 4) Client.pmId 제거
DROP INDEX IF EXISTS "Client_pmId_idx";
ALTER TABLE "Client" DROP CONSTRAINT IF EXISTS "Client_pmId_fkey";
ALTER TABLE "Client" DROP COLUMN "pmId";

-- 5) 조인 테이블 RLS: PM은 자신의 담당 행만, 배정 변경은 ADMIN/SETTLEMENT만
ALTER TABLE "ClientManager" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClientManager" FORCE ROW LEVEL SECURITY;
CREATE POLICY clientmanager_rls ON "ClientManager"
  USING (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR "userId" = current_setting('app.user_id', true)
  )
  WITH CHECK (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
  );

-- 6) 정책들을 ClientManager 기준으로 재생성
CREATE POLICY client_rls ON "Client"
  USING (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (SELECT 1 FROM "ClientManager" cm WHERE cm."clientId" = "Client".id AND cm."userId" = current_setting('app.user_id', true))
  )
  WITH CHECK (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (SELECT 1 FROM "ClientManager" cm WHERE cm."clientId" = "Client".id AND cm."userId" = current_setting('app.user_id', true))
  );

CREATE POLICY task_rls ON "Task"
  USING (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (SELECT 1 FROM "ClientManager" cm WHERE cm."clientId" = "Task"."clientId" AND cm."userId" = current_setting('app.user_id', true))
  )
  WITH CHECK (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (SELECT 1 FROM "ClientManager" cm WHERE cm."clientId" = "Task"."clientId" AND cm."userId" = current_setting('app.user_id', true))
  );

CREATE POLICY perf_rls ON "MonthlyPerformance"
  USING (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (
      SELECT 1 FROM "Task" t
      JOIN "ClientManager" cm ON cm."clientId" = t."clientId"
      WHERE t.id = "MonthlyPerformance"."taskId"
        AND cm."userId" = current_setting('app.user_id', true)
    )
  )
  WITH CHECK (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (
      SELECT 1 FROM "Task" t
      JOIN "ClientManager" cm ON cm."clientId" = t."clientId"
      WHERE t.id = "MonthlyPerformance"."taskId"
        AND cm."userId" = current_setting('app.user_id', true)
    )
  );

CREATE POLICY billing_rls ON "MonthlyBilling"
  USING (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (SELECT 1 FROM "ClientManager" cm WHERE cm."clientId" = "MonthlyBilling"."clientId" AND cm."userId" = current_setting('app.user_id', true))
  )
  WITH CHECK (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (SELECT 1 FROM "ClientManager" cm WHERE cm."clientId" = "MonthlyBilling"."clientId" AND cm."userId" = current_setting('app.user_id', true))
  );

CREATE POLICY deposit_rls ON "MonthlyDeposit"
  USING (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (SELECT 1 FROM "ClientManager" cm WHERE cm."clientId" = "MonthlyDeposit"."clientId" AND cm."userId" = current_setting('app.user_id', true))
  )
  WITH CHECK (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (SELECT 1 FROM "ClientManager" cm WHERE cm."clientId" = "MonthlyDeposit"."clientId" AND cm."userId" = current_setting('app.user_id', true))
  );

CREATE POLICY expense_rls ON "Expense"
  USING (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (SELECT 1 FROM "ClientManager" cm WHERE cm."clientId" = "Expense"."clientId" AND cm."userId" = current_setting('app.user_id', true))
  )
  WITH CHECK (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (SELECT 1 FROM "ClientManager" cm WHERE cm."clientId" = "Expense"."clientId" AND cm."userId" = current_setting('app.user_id', true))
  );
