-- PM이 프로젝트를 생성할 때 고객사 담당 PM(ClientManager)을 프로젝트(ProjectManager)로 승계할 수
-- 있도록 ProjectManager INSERT(WITH CHECK)를 완화한다.
-- 기존 문제: WITH CHECK가 SUPER_ADMIN/SETTLEMENT 또는 팀 ADMIN만 허용해, PM이 만든 프로젝트에는
--            담당 PM이 전혀 배정되지 않았다(카드에 담당 PM 체크가 비어 보이는 원인).
-- 완화 규칙: 배정 대상(userId)이 이미 그 프로젝트의 고객사 담당 PM(ClientManager)이면 허용한다.
--            "새로운 사람"을 배정하는 게 아니라 이미 고객사 담당인 사람을 프로젝트로 내리는 것이라
--            접근 권한이 확대되지 않는다. 또한 ClientManager는 RLS상 PM에게 본인 행만 보이므로,
--            PM은 사실상 자기 자신만 승계할 수 있다(타인 배정은 여전히 불가).
-- USING(조회 대상 행 제한)은 기존 app_can_see_client 유지.
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
    -- 신규: 그 고객사의 기존 담당 PM(ClientManager)을 프로젝트에 승계하는 경우 허용.
    OR EXISTS (
      SELECT 1 FROM "ClientManager" cm
      WHERE cm."userId" = "ProjectManager"."userId"
        AND cm."clientId" = (SELECT p."clientId" FROM "Project" p WHERE p.id = "ProjectManager"."projectId")
    )
  );
