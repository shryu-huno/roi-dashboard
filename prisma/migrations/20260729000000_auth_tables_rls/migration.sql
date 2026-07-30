-- =============================================================================
-- NextAuth(Prisma Adapter) 인증 테이블 RLS 활성화
-- -----------------------------------------------------------------------------
-- 배경: public 스키마의 테이블은 Supabase에서 PostgREST(REST API)로 자동 노출된다.
--       RLS가 꺼져 있으면 anon/authenticated API 키로 누구나 읽고 쓸 수 있어
--       Security Advisor가 "RLS Disabled in Public" / "Sensitive Columns Exposed"로 경고.
--
-- 방침: 이 테이블들의 접근제어는 애플리케이션 계층(도메인 제한 + NextAuth 세션)에서
--       수행하므로 "행 단위" 제약은 두지 않는다. 대신,
--         - 앱 접속 role(roi_app)  → 전면 허용 정책(USING true / WITH CHECK true)
--         - anon / authenticated   → 정책 없음 = 기본 거부 → PostgREST 접근 차단
--       테이블 소유자(postgres, DIRECT_URL/마이그레이션)와 service_role(BYPASSRLS)은
--       RLS를 우회하므로 마이그레이션·관리 작업에는 영향이 없다.
--
-- 참고: business 테이블(Client/Task/…)의 PM-스코프 RLS는 20260708080806_rls 참조.
--       roi_app role 생성/권한은 prisma/supabase-roi-app-role.sql 참조.
-- =============================================================================

-- 1) RLS 활성화 (이미 켜져 있어도 무해 — 멱등) --------------------------------
ALTER TABLE "User"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Account"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Session"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VerificationToken"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;

-- 2) 앱 role(roi_app) 전면 허용 정책 -----------------------------------------
--    roi_app role이 없는 환경(로컬 shadow DB, migrate dev 등)에서는 소유자 연결이
--    RLS를 우회하므로 정책 없이도 정상 동작한다. 따라서 role이 있을 때만 생성한다.
--    (role이 없는데 `CREATE POLICY ... TO roi_app`을 실행하면 오류가 나므로 가드 필수)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'roi_app') THEN
    EXECUTE 'DROP POLICY IF EXISTS auth_user_app    ON "User"';
    EXECUTE 'CREATE POLICY auth_user_app    ON "User"              FOR ALL TO roi_app USING (true) WITH CHECK (true)';

    EXECUTE 'DROP POLICY IF EXISTS auth_account_app ON "Account"';
    EXECUTE 'CREATE POLICY auth_account_app ON "Account"           FOR ALL TO roi_app USING (true) WITH CHECK (true)';

    EXECUTE 'DROP POLICY IF EXISTS auth_session_app ON "Session"';
    EXECUTE 'CREATE POLICY auth_session_app ON "Session"           FOR ALL TO roi_app USING (true) WITH CHECK (true)';

    EXECUTE 'DROP POLICY IF EXISTS auth_vtoken_app  ON "VerificationToken"';
    EXECUTE 'CREATE POLICY auth_vtoken_app  ON "VerificationToken" FOR ALL TO roi_app USING (true) WITH CHECK (true)';
  END IF;
END
$$;

-- _prisma_migrations: 런타임 앱은 접근하지 않고(마이그레이션은 DIRECT_URL=postgres 소유자),
--                     RLS만 켜서 PostgREST 노출을 차단한다. 별도 정책 불필요.
