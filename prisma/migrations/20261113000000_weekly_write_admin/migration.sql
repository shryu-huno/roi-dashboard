-- 주간 공유 작성 권한을 최고관리자·팀 관리자까지 넓힌다.
-- 고객사 일지: 역할이 PM·파트장·팀 관리자·최고관리자이고 그 고객사의 담당자(ClientManager)로 배정돼 있어야 쓴다.
--   (담당 고객사가 없는 관리자는 쓸 고객사가 없다 — 담당자 조건은 그대로다.)
-- 기타 업무: 같은 역할이 본인 것(authorId = 본인)만 쓰고 수정한다.
-- 정책·함수만 바꾼다. 테이블 구조와 기존 데이터는 변경하지 않는다. 열람 정책(select)은 그대로.

CREATE OR REPLACE FUNCTION app_can_write_weekly_share(cid TEXT)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT current_setting('app.user_role', true) IN ('PM', 'PART_LEADER', 'ADMIN', 'SUPER_ADMIN')
    AND EXISTS (
      SELECT 1 FROM "ClientManager" cm
      WHERE cm."clientId" = cid
        AND cm."userId" = current_setting('app.user_id', true)
    );
$$;

DROP POLICY weeklyotherwork_insert ON "WeeklyOtherWork";
CREATE POLICY weeklyotherwork_insert ON "WeeklyOtherWork" FOR INSERT
  WITH CHECK (
    current_setting('app.user_role', true) IN ('PM', 'PART_LEADER', 'ADMIN', 'SUPER_ADMIN')
    AND "WeeklyOtherWork"."authorId" = current_setting('app.user_id', true)
  );

DROP POLICY weeklyotherwork_update ON "WeeklyOtherWork";
CREATE POLICY weeklyotherwork_update ON "WeeklyOtherWork" FOR UPDATE
  USING (
    current_setting('app.user_role', true) IN ('PM', 'PART_LEADER', 'ADMIN', 'SUPER_ADMIN')
    AND "WeeklyOtherWork"."authorId" = current_setting('app.user_id', true)
  )
  WITH CHECK (
    current_setting('app.user_role', true) IN ('PM', 'PART_LEADER', 'ADMIN', 'SUPER_ADMIN')
    AND "WeeklyOtherWork"."authorId" = current_setting('app.user_id', true)
  );
