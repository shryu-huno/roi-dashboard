-- 주간 공유 "지원 나간 고객사" 선택 목록용 고객사 이름 조회 허용.
-- PM은 RLS상 다른 PM의 고객사를 읽을 수 없어, 기타 업무에서 지원 대상 고객사를 고를 목록을 만들 수 없다.
-- 앱이 한 트랜잭션 안에서만 app.lookup = 'support-clients' 를 설정하고(set_config의 local 옵션 → 트랜잭션 종료 시 자동 해제),
-- 그때에 한해 활성(보관되지 않은) 고객사 행을 SELECT 할 수 있게 하는 정책을 추가한다.
-- 이 정책은 SELECT 전용이며 다른 정책(client_rls)과 OR로 합쳐진다. 쓰기 권한은 넓히지 않는다.
-- 앱 코드는 이 모드에서 id·name 두 컬럼만 조회한다(src/lib/data/weekly-share.ts#listSupportClientOptions).
CREATE POLICY client_support_lookup ON "Client" FOR SELECT
  USING (
    current_setting('app.lookup', true) = 'support-clients'
    AND current_setting('app.user_role', true) IN ('PM', 'PART_LEADER', 'SUPER_ADMIN', 'ADMIN')
    AND "Client"."deletedAt" IS NULL
  );
