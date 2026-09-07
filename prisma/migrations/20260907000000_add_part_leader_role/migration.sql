-- 파트장(PART_LEADER) 역할 추가.
-- Postgres에서 ALTER TYPE ... ADD VALUE 로 추가한 enum 라벨은 "같은 트랜잭션 안에서는"
-- 값으로 사용할 수 없다(PG 12+). Prisma는 마이그레이션 파일마다 별도 트랜잭션으로 적용하므로,
-- 라벨 추가만 이 마이그레이션에 두고, 컬럼·정책 변경은 다음 마이그레이션
-- (20260907000100_part_leader_scoping)에서 수행한다. (add_super_admin 관례와 동일)
-- 순서상 팀 관리자(ADMIN) 다음에 배치한다.
ALTER TYPE "Role" ADD VALUE 'PART_LEADER' AFTER 'ADMIN';
