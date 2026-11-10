-- 입찰·수주(Bid) 도입. 파트 현황 옆의 "입찰·수주" 탭에서 최고관리자·팀 관리자가 입찰을 등록·수정한다.
-- 담당 PM·고객사와는 연결하지 않는다(발주처는 자유 입력).
--
-- 권한(RLS): 읽기·등록·수정은 최고관리자(SUPER_ADMIN)와 팀 관리자(ADMIN)만. DELETE 정책은 두지 않는다
-- (잘못 등록한 건은 수정한다). 신규 빈 테이블이라 백필 없음. GRANT는 supabase-roi-app-role.sql의
-- ALTER DEFAULT PRIVILEGES가 자동 부여.

CREATE TYPE "BidKind" AS ENUM ('NEW', 'RENEWAL');
CREATE TYPE "BidStatus" AS ENUM ('PREPARING', 'REVIEWING', 'WON', 'LOST', 'FAILED');

CREATE TABLE "Bid" (
  "id"           TEXT NOT NULL,
  "orgName"      TEXT NOT NULL,
  "title"        TEXT NOT NULL,
  "kind"         "BidKind" NOT NULL DEFAULT 'NEW',
  "amount"       INTEGER NOT NULL,
  "dueDate"      DATE NOT NULL,
  "announceDate" DATE NOT NULL,
  "status"       "BidStatus" NOT NULL DEFAULT 'PREPARING',
  "note"         TEXT NOT NULL DEFAULT '',
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Bid_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Bid_status_idx" ON "Bid"("status");
CREATE INDEX "Bid_dueDate_idx" ON "Bid"("dueDate");

ALTER TABLE "Bid" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Bid" FORCE ROW LEVEL SECURITY;
CREATE POLICY bid_select ON "Bid" FOR SELECT
  USING (current_setting('app.user_role', true) IN ('SUPER_ADMIN', 'ADMIN'));
CREATE POLICY bid_insert ON "Bid" FOR INSERT
  WITH CHECK (current_setting('app.user_role', true) IN ('SUPER_ADMIN', 'ADMIN'));
CREATE POLICY bid_update ON "Bid" FOR UPDATE
  USING (current_setting('app.user_role', true) IN ('SUPER_ADMIN', 'ADMIN'))
  WITH CHECK (current_setting('app.user_role', true) IN ('SUPER_ADMIN', 'ADMIN'));
