-- =============================================================================
-- Supabase(및 임의의 Postgres)용 RLS-안전 앱 접속 role 설정
-- -----------------------------------------------------------------------------
-- 이 앱은 Postgres RLS로 "PM은 본인 담당 고객사만" 을 강제한다.
-- 앱은 반드시 슈퍼유저/BYPASSRLS가 아닌 전용 role(roi_app)로 접속해야 정책이 적용된다.
--
-- 실행 위치: Supabase 대시보드 → SQL Editor (기본 실행 role = postgres)
--            또는 psql로 DIRECT 연결(포트 5432, user=postgres)
--
-- 실행 순서:
--   (A) 아래 "1) role 생성" 블록 실행
--   (B) 터미널에서  `npx prisma migrate deploy`  (DIRECT_URL 사용, postgres 소유로 테이블 생성)
--   (C) 아래 "2) 권한 부여" 블록 실행
--   (D) "3) 확인" 쿼리로 rolbypassrls = false 인지 검증
-- =============================================================================

-- 1) 앱 전용 role -------------------------------------------------------------
--    LOGIN만 부여. SUPERUSER/BYPASSRLS는 주지 않는다(기본값이 false).
--    ⚠️ 'CHANGE_ME...' 를 강력한 실제 비밀번호로 바꾸고, 그 값을 앱 DATABASE_URL에 사용.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'roi_app') THEN
    CREATE ROLE roi_app LOGIN PASSWORD 'CHANGE_ME_강력한_비밀번호';
  END IF;
END
$$;

-- Supabase 기본 데이터베이스명은 postgres. (자체 Postgres에서 별도 DB를 쓰면 그 이름으로 바꿀 것.)
GRANT CONNECT ON DATABASE postgres TO roi_app;
GRANT USAGE   ON SCHEMA   public   TO roi_app;

-- ---------------------------------------------------------------------------
-- 여기서 멈추고  `npx prisma migrate deploy`  를 먼저 실행한 뒤, 아래를 이어서 실행.
-- ---------------------------------------------------------------------------

-- 2) 권한 부여 (마이그레이션으로 테이블이 생성된 "후" 실행) -------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO roi_app;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO roi_app;

-- 앞으로 postgres가 만들 새 테이블/시퀀스(향후 마이그레이션)에도 자동 부여
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO roi_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO roi_app;

-- 3) 확인 --------------------------------------------------------------------
--    roi_app 은 rolsuper=false, rolbypassrls=false 여야 RLS가 정상 적용된다.
SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
FROM pg_roles
WHERE rolname IN ('roi_app', 'postgres')
ORDER BY rolname;
