-- 파트장(PART_LEADER) 스코프 도입.
-- - 파트장은 "자기에게 소속된(partLeaderId=본인) PM이 담당하는 고객사"만 열람·관리한다.
-- - 팀 관리자(ADMIN)의 teamId 스코프를 partLeaderId 스코프로 치환한 평행 규칙이다.
-- - 팀 관리자는 여전히 팀 전체(teamId)를 보므로 파트장 범위는 그 부분집합(계층 성립).
-- 파트장 접근 범위도 별도 필드 없이 담당 PM(ClientManager→User.partLeaderId)에서 도출한다.
--
-- 마이그레이션은 DIRECT_URL(postgres 소유자)로 적용된다. RLS 헬퍼는 이미 세팅되는 app.user_id를
-- 사용하므로 새 RLS 컨텍스트 변수는 필요 없다.

-- 1) User.partLeaderId 컬럼 + 자기참조 FK + 인덱스 --------------------------------
ALTER TABLE "User" ADD COLUMN "partLeaderId" TEXT;
ALTER TABLE "User" ADD CONSTRAINT "User_partLeaderId_fkey"
  FOREIGN KEY ("partLeaderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "User_partLeaderId_idx" ON "User"("partLeaderId");

-- 2) 고객사 열람 가능 여부 헬퍼 재정의 — 기존 3규칙 + 파트장 규칙 --------------------
--    CREATE OR REPLACE는 기존 GRANT(roi_app)를 보존한다.
CREATE OR REPLACE FUNCTION app_can_see_client(cid TEXT)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    -- 전체 열람 역할
    current_setting('app.user_role', true) IN ('SUPER_ADMIN', 'SETTLEMENT')
    -- PM: 본인이 직접 배정된 고객사
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
    )
    -- 파트장: 그 고객사에 자기 소속(partLeaderId=본인) PM이 한 명이라도 배정돼 있으면
    OR (
      current_setting('app.user_role', true) = 'PART_LEADER'
      AND EXISTS (
        SELECT 1 FROM "ClientManager" cm
        JOIN "User" u ON u."id" = cm."userId"
        WHERE cm."clientId" = cid
          AND u."partLeaderId" = current_setting('app.user_id', true)
      )
    );
$$;

-- 3) ClientManager 정책 재작성 — USING/WITH CHECK 모두 파트장 branch 추가.
--    USING에 파트장을 넣어야 SECURITY INVOKER 헬퍼의 EXISTS(자기 PM의 cm 행 조회)가 동작한다.
--    WITH CHECK은 "자기 소속 PM만 배정" 제약. 재귀 방지를 위해 헬퍼 대신 User를 직접 검사.
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
    OR (
      current_setting('app.user_role', true) = 'PART_LEADER'
      AND EXISTS (
        SELECT 1 FROM "User" u
        WHERE u."id" = "ClientManager"."userId"
          AND u."partLeaderId" = current_setting('app.user_id', true)
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
    OR (
      current_setting('app.user_role', true) = 'PART_LEADER'
      AND EXISTS (
        SELECT 1 FROM "User" u
        WHERE u."id" = "ClientManager"."userId"
          AND u."partLeaderId" = current_setting('app.user_id', true)
      )
    )
  );

-- 4) ProjectManager 정책 재작성 — WITH CHECK에 파트장 branch 추가.
--    (USING은 헬퍼 경유라 자동 반영. 마지막 OR: 고객사 담당 PM 승계 완화는 유지.)
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
    OR (
      current_setting('app.user_role', true) = 'PART_LEADER'
      AND EXISTS (
        SELECT 1 FROM "User" u
        WHERE u."id" = "ProjectManager"."userId"
          AND u."partLeaderId" = current_setting('app.user_id', true)
      )
    )
    OR EXISTS (
      SELECT 1 FROM "ClientManager" cm
      WHERE cm."userId" = "ProjectManager"."userId"
        AND cm."clientId" = (SELECT p."clientId" FROM "Project" p WHERE p.id = "ProjectManager"."projectId")
    )
  );

-- 5) Client INSERT 완화 — 파트장도 신규 고객사를 생성할 수 있게 한다(ADMIN 완화와 동형).
--    생성 시점에는 담당 PM이 없어 app_can_see_client가 false이므로 WITH CHECK에 역할 토큰을 더한다.
--    "자기 소속 PM만 배정" 제약은 ClientManager WITH CHECK가 그대로 강제하고, 생성 후 자기 PM을
--    배정해야 USING(app_can_see_client)로 목록에 보인다.
DROP POLICY client_rls ON "Client";
CREATE POLICY client_rls ON "Client"
  USING (app_can_see_client("Client".id))
  WITH CHECK (
    app_can_see_client("Client".id)
    OR (
      current_setting('app.user_role', true) = 'ADMIN'
      AND nullif(current_setting('app.team_id', true), '') IS NOT NULL
    )
    OR current_setting('app.user_role', true) = 'PART_LEADER'
  );
