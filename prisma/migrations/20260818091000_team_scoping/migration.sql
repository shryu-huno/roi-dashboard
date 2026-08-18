-- 팀 단위 접근 격리 도입.
-- - 팀 관리자(ADMIN)는 "자기 팀 소속 PM이 담당하는 고객사"만 열람한다.
-- - 최고관리자(SUPER_ADMIN)·정산담당자(SETTLEMENT)는 팀 구분 없이 전체 열람(기존 ADMIN 동작).
-- - PM은 기존과 동일하게 ClientManager로 직접 배정된 고객사만.
-- 고객사의 팀 귀속은 별도 필드 없이 담당 PM(ClientManager→User.teamId)에서 도출한다.
--
-- 마이그레이션은 DIRECT_URL(postgres 소유자)로 적용된다. User는 ENABLE RLS(FORCE 아님)이라
-- 소유자가 RLS를 우회하므로 아래 UPDATE에 앱 컨텍스트 주입이 필요 없다.

-- 1) 팀 테이블 -----------------------------------------------------------------
CREATE TABLE "Team" (
  "id"        TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- 2) User.teamId 컬럼 + FK + 인덱스 -------------------------------------------
ALTER TABLE "User" ADD COLUMN "teamId" TEXT;
ALTER TABLE "User" ADD CONSTRAINT "User_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "User_teamId_idx" ON "User"("teamId");

-- 3) 데이터 이관: 기존 ADMIN → SUPER_ADMIN (전체 열람 동작 보존) ---------------
UPDATE "User" SET "role" = 'SUPER_ADMIN' WHERE "role" = 'ADMIN';

-- 4) 팀 테이블 RLS: 전원 조회 허용, 쓰기는 최고관리자·정산담당자만 -------------
ALTER TABLE "Team" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Team" FORCE ROW LEVEL SECURITY;
CREATE POLICY team_select ON "Team" FOR SELECT USING (true);
CREATE POLICY team_write_admin ON "Team"
  FOR ALL
  USING (current_setting('app.user_role', true) IN ('SUPER_ADMIN', 'SETTLEMENT'))
  WITH CHECK (current_setting('app.user_role', true) IN ('SUPER_ADMIN', 'SETTLEMENT'));

-- 5) 고객사 열람 가능 여부 헬퍼 함수 ------------------------------------------
--    SECURITY INVOKER(기본): 호출자(roi_app) 권한으로 실행되어 내부의 ClientManager/User
--    조회에도 각 테이블 RLS가 적용된다. clientmanager_rls·auth_user_app가 이 함수를 다시
--    호출하지 않으므로(아래 정책은 User.teamId를 직접 검사) 재귀가 없다.
--    STABLE: current_setting과 테이블을 읽으므로 IMMUTABLE 불가.
CREATE OR REPLACE FUNCTION app_can_see_client(cid TEXT)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    -- 전체 열람 역할
    current_setting('app.user_role', true) IN ('SUPER_ADMIN', 'SETTLEMENT')
    -- PM: 본인이 직접 배정된 고객사(기존 의미 유지)
    OR EXISTS (
      SELECT 1 FROM "ClientManager" cm
      WHERE cm."clientId" = cid
        AND cm."userId" = current_setting('app.user_id', true)
    )
    -- 팀 관리자: 그 고객사에 자기 팀(app.team_id) 소속 PM이 한 명이라도 배정돼 있으면
    OR (
      current_setting('app.user_role', true) = 'ADMIN'
      AND nullif(current_setting('app.team_id', true), '') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM "ClientManager" cm
        JOIN "User" u ON u."id" = cm."userId"
        WHERE cm."clientId" = cid
          AND u."teamId" = current_setting('app.team_id', true)
      )
    );
$$;

GRANT EXECUTE ON FUNCTION app_can_see_client(TEXT) TO roi_app;

-- 6) 업무 테이블 정책 재작성 — 전체-열람 토큰(구 'ADMIN','SETTLEMENT')을 헬퍼로 흡수.
--    직접 clientId 보유 테이블: USING/WITH CHECK 모두 헬퍼 호출.
DROP POLICY client_rls ON "Client";
CREATE POLICY client_rls ON "Client"
  USING (app_can_see_client("Client".id))
  WITH CHECK (app_can_see_client("Client".id));

DROP POLICY task_rls ON "Task";
CREATE POLICY task_rls ON "Task"
  USING (app_can_see_client("Task"."clientId"))
  WITH CHECK (app_can_see_client("Task"."clientId"));

DROP POLICY billing_rls ON "MonthlyBilling";
CREATE POLICY billing_rls ON "MonthlyBilling"
  USING (app_can_see_client("MonthlyBilling"."clientId"))
  WITH CHECK (app_can_see_client("MonthlyBilling"."clientId"));

DROP POLICY deposit_rls ON "MonthlyDeposit";
CREATE POLICY deposit_rls ON "MonthlyDeposit"
  USING (app_can_see_client("MonthlyDeposit"."clientId"))
  WITH CHECK (app_can_see_client("MonthlyDeposit"."clientId"));

DROP POLICY expense_rls ON "Expense";
CREATE POLICY expense_rls ON "Expense"
  USING (app_can_see_client("Expense"."clientId"))
  WITH CHECK (app_can_see_client("Expense"."clientId"));

DROP POLICY project_rls ON "Project";
CREATE POLICY project_rls ON "Project"
  USING (app_can_see_client("Project"."clientId"))
  WITH CHECK (app_can_see_client("Project"."clientId"));

DROP POLICY consulting_expense_rls ON "ConsultingExpense";
CREATE POLICY consulting_expense_rls ON "ConsultingExpense"
  USING (app_can_see_client("ConsultingExpense"."clientId"))
  WITH CHECK (app_can_see_client("ConsultingExpense"."clientId"));

DROP POLICY corporate_card_expense_rls ON "CorporateCardExpense";
CREATE POLICY corporate_card_expense_rls ON "CorporateCardExpense"
  USING (app_can_see_client("CorporateCardExpense"."clientId"))
  WITH CHECK (app_can_see_client("CorporateCardExpense"."clientId"));

-- 조인 테이블: 소속 고객사 id를 스칼라 서브셀렉트로 얻어 헬퍼에 전달.
DROP POLICY perf_rls ON "MonthlyPerformance";
CREATE POLICY perf_rls ON "MonthlyPerformance"
  USING (app_can_see_client((SELECT t."clientId" FROM "Task" t WHERE t.id = "MonthlyPerformance"."taskId")))
  WITH CHECK (app_can_see_client((SELECT t."clientId" FROM "Task" t WHERE t.id = "MonthlyPerformance"."taskId")));

-- 7) ClientManager: 조회는 헬퍼 또는 본인 행. 쓰기(배정)는 전체-열람 역할 또는
--    팀 관리자(대상 PM이 자기 팀 소속일 때만). 재귀 방지를 위해 헬퍼 대신 User.teamId 직접 검사.
DROP POLICY clientmanager_rls ON "ClientManager";
CREATE POLICY clientmanager_rls ON "ClientManager"
  USING (
    current_setting('app.user_role', true) IN ('SUPER_ADMIN', 'SETTLEMENT')
    OR "userId" = current_setting('app.user_id', true)
    OR (
      current_setting('app.user_role', true) = 'ADMIN'
      AND nullif(current_setting('app.team_id', true), '') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM "User" u
        WHERE u."id" = "ClientManager"."userId"
          AND u."teamId" = current_setting('app.team_id', true)
      )
    )
  )
  WITH CHECK (
    current_setting('app.user_role', true) IN ('SUPER_ADMIN', 'SETTLEMENT')
    OR (
      current_setting('app.user_role', true) = 'ADMIN'
      AND nullif(current_setting('app.team_id', true), '') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM "User" u
        WHERE u."id" = "ClientManager"."userId"
          AND u."teamId" = current_setting('app.team_id', true)
      )
    )
  );

-- 8) ProjectManager: 조회는 소속 고객사 헬퍼. 쓰기는 ClientManager와 동일 규칙(자기 팀 PM만).
DROP POLICY projectmanager_rls ON "ProjectManager";
CREATE POLICY projectmanager_rls ON "ProjectManager"
  USING (app_can_see_client((SELECT p."clientId" FROM "Project" p WHERE p.id = "ProjectManager"."projectId")))
  WITH CHECK (
    current_setting('app.user_role', true) IN ('SUPER_ADMIN', 'SETTLEMENT')
    OR (
      current_setting('app.user_role', true) = 'ADMIN'
      AND nullif(current_setting('app.team_id', true), '') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM "User" u
        WHERE u."id" = "ProjectManager"."userId"
          AND u."teamId" = current_setting('app.team_id', true)
      )
    )
  );

-- 9) 전역 원장(Payee/PaymentRequest/Notice): 팀 관리자에게 쓰기 없음.
--    전체-열람 쓰기 토큰 'ADMIN' → 'SUPER_ADMIN'으로 교체. PM 카브아웃 정책은 유지.
DROP POLICY payee_write ON "Payee";
CREATE POLICY payee_write ON "Payee"
  USING (current_setting('app.user_role', true) IN ('SUPER_ADMIN', 'SETTLEMENT'))
  WITH CHECK (current_setting('app.user_role', true) IN ('SUPER_ADMIN', 'SETTLEMENT'));

DROP POLICY payee_attachment_write ON "PayeeAttachment";
CREATE POLICY payee_attachment_write ON "PayeeAttachment"
  USING (current_setting('app.user_role', true) IN ('SUPER_ADMIN', 'SETTLEMENT'))
  WITH CHECK (current_setting('app.user_role', true) IN ('SUPER_ADMIN', 'SETTLEMENT'));

-- PaymentRequest: 조회는 헬퍼로(고객사 스코프), 전체-열람 쓰기 토큰 교체. PM 정책 유지.
DROP POLICY payment_request_select ON "PaymentRequest";
CREATE POLICY payment_request_select ON "PaymentRequest"
  FOR SELECT
  USING (app_can_see_client("PaymentRequest"."clientId"));

DROP POLICY payment_request_write_admin ON "PaymentRequest";
CREATE POLICY payment_request_write_admin ON "PaymentRequest"
  FOR ALL
  USING (current_setting('app.user_role', true) IN ('SUPER_ADMIN', 'SETTLEMENT'))
  WITH CHECK (current_setting('app.user_role', true) IN ('SUPER_ADMIN', 'SETTLEMENT'));

DROP POLICY payment_request_notice_write_admin ON "PaymentRequestNotice";
CREATE POLICY payment_request_notice_write_admin ON "PaymentRequestNotice"
  FOR ALL
  USING (current_setting('app.user_role', true) IN ('SUPER_ADMIN', 'SETTLEMENT'))
  WITH CHECK (current_setting('app.user_role', true) IN ('SUPER_ADMIN', 'SETTLEMENT'));
