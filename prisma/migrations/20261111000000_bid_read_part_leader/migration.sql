-- 입찰·수주를 파트장도 볼 수 있게 한다(읽기 전용). 등록·수정 정책(최고관리자·팀 관리자)은 그대로다.
DROP POLICY bid_select ON "Bid";
CREATE POLICY bid_select ON "Bid" FOR SELECT
  USING (current_setting('app.user_role', true) IN ('SUPER_ADMIN', 'ADMIN', 'PART_LEADER'));
