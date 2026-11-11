-- 주간 공유를 "고객사·주당 1건 공동 편집"에서 "작성자(담당 PM)별 1건"으로 바꾼다.
-- 공동 담당 고객사는 담당자마다 같은 주에 각자 일지를 남기고(PM별 업무 파악), 고객사 히스토리에서는 그 주의 일지가
-- 작성자별로 나란히 보인다. 한 담당자라도 쓰면 그 고객사·주는 작성된 것으로 본다.
--
--  · 유일 키: (weekStart, clientId) → (weekStart, clientId, createdById). createdById가 작성자(수정해도 바뀌지 않는다).
--  · 수정 RLS: 그 고객사 담당이면서 작성자 본인(createdById = 본인)인 행만. 다른 담당자의 일지는 읽기만 가능하다.
--  · 열람(select)·입력(insert) 정책과 테이블 구조는 그대로다. 기존 행은 (주, 고객사)당 1건이라 새 유일 키를 만족한다.
DROP INDEX "WeeklyShare_weekStart_clientId_key";
CREATE UNIQUE INDEX "WeeklyShare_weekStart_clientId_createdById_key" ON "WeeklyShare"("weekStart", "clientId", "createdById");

DROP POLICY weeklyshare_update ON "WeeklyShare";
CREATE POLICY weeklyshare_update ON "WeeklyShare" FOR UPDATE
  USING (
    app_can_write_weekly_share("WeeklyShare"."clientId")
    AND "WeeklyShare"."createdById" = current_setting('app.user_id', true)
  )
  WITH CHECK (
    app_can_write_weekly_share("WeeklyShare"."clientId")
    AND "WeeklyShare"."createdById" = current_setting('app.user_id', true)
    AND "WeeklyShare"."updatedById" = current_setting('app.user_id', true)
  );
