-- "지원 나간 고객사" 선택 기능을 제거한다(기획에서 제외).
--  · 고객사 이름 조회 허용 정책(client_support_lookup)과 WeeklyOtherWork.supportClientId 컬럼을 없애고,
--  · 기타 업무 열람 정책에서 "지원 대상 고객사를 볼 수 있는 사람" 조건을 뺀다
--    (본인 / 최고관리자 전체 / 팀 관리자 팀원 / 파트장 소속 PM 범위만 남는다).
-- 두 마이그레이션(20261107·20261108)은 아직 운영에 배포된 적이 없지만, 로컬/테스트 DB에 이미 적용됐으므로
-- 기존 파일을 고치지 않고 이 마이그레이션으로 되돌린다. 아직 이 컬럼에 저장된 값은 없다(화면에서 쓰인 적이 없음).
DROP POLICY IF EXISTS client_support_lookup ON "Client";

DROP POLICY weeklyotherwork_select ON "WeeklyOtherWork";
CREATE POLICY weeklyotherwork_select ON "WeeklyOtherWork" FOR SELECT
  USING (app_can_see_weekly_author("WeeklyOtherWork"."authorId"));

ALTER TABLE "WeeklyOtherWork" DROP CONSTRAINT "WeeklyOtherWork_supportClientId_fkey";
DROP INDEX "WeeklyOtherWork_supportClientId_idx";
ALTER TABLE "WeeklyOtherWork" DROP COLUMN "supportClientId";
