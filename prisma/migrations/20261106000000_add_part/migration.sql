-- 팀 아래 파트(Part) 도입. 사용자는 User.partId로 파트 1개에 소속된다.
-- 파트장 = 그 파트에 속한 활성 PART_LEADER. PM의 partLeaderId(기존 파트장 권한 RLS 기준)는
-- 앱이 partId에서 파트장으로 동기화하므로 기존 RLS 정책은 변경하지 않는다.
-- 신규 빈 테이블이라 백필 없음. GRANT는 supabase-roi-app-role.sql의 ALTER DEFAULT PRIVILEGES가 자동 부여.

-- 1) 테이블 + 제약 + 인덱스 ------------------------------------------------------
CREATE TABLE "Part" (
  "id"        TEXT NOT NULL,
  "teamId"    TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Part_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Part_teamId_name_key" ON "Part"("teamId", "name");
CREATE INDEX "Part_teamId_idx" ON "Part"("teamId");
ALTER TABLE "Part" ADD CONSTRAINT "Part_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2) User.partId -----------------------------------------------------------------
ALTER TABLE "User" ADD COLUMN "partId" TEXT;
CREATE INDEX "User_partId_idx" ON "User"("partId");
ALTER TABLE "User" ADD CONSTRAINT "User_partId_fkey"
  FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3) RLS: 전원 조회, 쓰기는 최고관리자·정산담당자만(Team과 동일) -------------------
ALTER TABLE "Part" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Part" FORCE ROW LEVEL SECURITY;
CREATE POLICY part_select ON "Part" FOR SELECT USING (true);
CREATE POLICY part_write_admin ON "Part"
  FOR ALL
  USING (current_setting('app.user_role', true) IN ('SUPER_ADMIN', 'SETTLEMENT'))
  WITH CHECK (current_setting('app.user_role', true) IN ('SUPER_ADMIN', 'SETTLEMENT'));
