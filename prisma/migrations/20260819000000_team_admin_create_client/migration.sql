-- 팀 관리자(ADMIN)도 고객사를 생성할 수 있도록 Client RLS의 INSERT(WITH CHECK)를 완화한다.
-- 기존 문제: 생성 시점에는 담당 PM(ClientManager)이 아직 없어 app_can_see_client가 false →
--            팀 관리자의 Client INSERT가 RLS로 막혔다.
-- 완화 규칙: 팀(app.team_id)이 지정된 ADMIN이면 INSERT를 허용한다. "자기 팀 PM만 배정" 제약은
--            ClientManager WITH CHECK(대상 PM의 teamId = app.team_id)가 그대로 강제한다.
-- USING(조회·수정 대상 행 제한)은 기존 app_can_see_client 유지 → 팀 범위를 벗어난 고객사에는
--       여전히 접근할 수 없다(생성 후에도 자기 팀 PM이 배정돼야 목록에 보인다).
DROP POLICY client_rls ON "Client";
CREATE POLICY client_rls ON "Client"
  USING (app_can_see_client("Client".id))
  WITH CHECK (
    app_can_see_client("Client".id)
    OR (
      current_setting('app.user_role', true) = 'ADMIN'
      AND nullif(current_setting('app.team_id', true), '') IS NOT NULL
    )
  );
