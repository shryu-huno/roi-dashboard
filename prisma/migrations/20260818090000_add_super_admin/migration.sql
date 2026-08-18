-- 최고관리자(SUPER_ADMIN) 역할 추가.
-- Postgres에서 ALTER TYPE ... ADD VALUE 로 추가한 enum 라벨은 "같은 트랜잭션 안에서는"
-- 값으로 사용할 수 없다(PG 12+). Prisma는 마이그레이션 파일마다 별도 트랜잭션으로 적용하므로,
-- 라벨 추가만 이 마이그레이션에 두고, 그 값을 사용하는 UPDATE/정책은 다음 마이그레이션
-- (20260818091000_team_scoping)에서 수행한다.
ALTER TYPE "Role" ADD VALUE 'SUPER_ADMIN';
