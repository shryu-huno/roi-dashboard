-- 주간 공유: 고객사별 주간 공유(WeeklyShare)와 PM별 기타 업무(WeeklyOtherWork) 도입.
-- 주 키(weekStart)는 그 주 일요일 날짜(DATE). 같은 (주, 고객사) / (주, PM)은 1건만 존재한다.
--
-- 권한(RLS) 요약
--  · WeeklyShare 읽기: 그 고객사를 볼 수 있는 사람(app_can_see_client — 담당 PM·소속 파트장·팀 관리자·전체 접근).
--  · WeeklyShare 쓰기: 그 고객사에 담당 PM(ClientManager)으로 배정된 PM/파트장만. 최고관리자·팀 관리자는
--    쓰기 정책이 없어 DB 수준에서 수정 불가. DELETE 정책 없음(삭제 불가).
--  · WeeklyOtherWork 읽기: 본인, 관리자 범위(최고관리자 전체/팀 관리자 팀원/파트장 소속 PM), 또는
--    지원 대상 고객사를 볼 수 있는 사람(고객사 히스토리의 "지원" 줄용). 쓰기: 본인(PM/파트장)만.
-- 신규 빈 테이블이라 백필 없음. GRANT는 supabase-roi-app-role.sql의 ALTER DEFAULT PRIVILEGES가 자동 부여.

-- 1) 테이블 + 제약 + 인덱스 ------------------------------------------------------
CREATE TABLE "WeeklyShare" (
  "id"          TEXT NOT NULL,
  "weekStart"   DATE NOT NULL,
  "clientId"    TEXT NOT NULL,
  "thisWeek"    TEXT NOT NULL DEFAULT '',
  "nextWeek"    TEXT NOT NULL DEFAULT '',
  "note"        TEXT NOT NULL DEFAULT '',
  "noSpecial"   BOOLEAN NOT NULL DEFAULT false,
  "createdById" TEXT,
  "updatedById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  "editedAt"    TIMESTAMP(3),
  "version"     INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "WeeklyShare_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WeeklyShare_weekStart_clientId_key" ON "WeeklyShare"("weekStart", "clientId");
CREATE INDEX "WeeklyShare_clientId_idx" ON "WeeklyShare"("clientId");
CREATE INDEX "WeeklyShare_weekStart_idx" ON "WeeklyShare"("weekStart");
ALTER TABLE "WeeklyShare" ADD CONSTRAINT "WeeklyShare_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WeeklyShare" ADD CONSTRAINT "WeeklyShare_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WeeklyShare" ADD CONSTRAINT "WeeklyShare_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "WeeklyOtherWork" (
  "id"              TEXT NOT NULL,
  "weekStart"       DATE NOT NULL,
  "authorId"        TEXT,
  "tags"            TEXT[] DEFAULT ARRAY[]::TEXT[],
  "thisWeek"        TEXT NOT NULL DEFAULT '',
  "nextWeek"        TEXT NOT NULL DEFAULT '',
  "note"            TEXT NOT NULL DEFAULT '',
  "supportClientId" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  "editedAt"        TIMESTAMP(3),
  CONSTRAINT "WeeklyOtherWork_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WeeklyOtherWork_weekStart_authorId_key" ON "WeeklyOtherWork"("weekStart", "authorId");
CREATE INDEX "WeeklyOtherWork_supportClientId_idx" ON "WeeklyOtherWork"("supportClientId");
CREATE INDEX "WeeklyOtherWork_weekStart_idx" ON "WeeklyOtherWork"("weekStart");
ALTER TABLE "WeeklyOtherWork" ADD CONSTRAINT "WeeklyOtherWork_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WeeklyOtherWork" ADD CONSTRAINT "WeeklyOtherWork_supportClientId_fkey"
  FOREIGN KEY ("supportClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2) 권한 헬퍼 함수(SECURITY INVOKER: 호출자 권한으로 실행되어 내부 조회에도 각 테이블 RLS가 적용된다) ----
-- 주간 공유를 쓸 수 있는가: PM/파트장 역할이고 그 고객사의 담당 PM(ClientManager)으로 배정돼 있다.
CREATE OR REPLACE FUNCTION app_can_write_weekly_share(cid TEXT)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT current_setting('app.user_role', true) IN ('PM', 'PART_LEADER')
    AND EXISTS (
      SELECT 1 FROM "ClientManager" cm
      WHERE cm."clientId" = cid
        AND cm."userId" = current_setting('app.user_id', true)
    );
$$;

-- 이 작성자의 기타 업무를 볼 수 있는가: 본인 / 최고관리자 전체 / 팀 관리자는 자기 팀 소속 / 파트장은 자기 소속 PM.
CREATE OR REPLACE FUNCTION app_can_see_weekly_author(author TEXT)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    current_setting('app.user_role', true) = 'SUPER_ADMIN'
    OR author = current_setting('app.user_id', true)
    OR (
      current_setting('app.user_role', true) = 'ADMIN'
      AND nullif(current_setting('app.team_id', true), '') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM "User" u
        WHERE u."id" = author
          AND u."teamId" = current_setting('app.team_id', true)
      )
    )
    OR (
      current_setting('app.user_role', true) = 'PART_LEADER'
      AND EXISTS (
        SELECT 1 FROM "User" u
        WHERE u."id" = author
          AND u."partLeaderId" = current_setting('app.user_id', true)
      )
    );
$$;

-- 3) RLS ---------------------------------------------------------------------------
ALTER TABLE "WeeklyShare" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WeeklyShare" FORCE ROW LEVEL SECURITY;
CREATE POLICY weeklyshare_select ON "WeeklyShare" FOR SELECT
  USING (app_can_see_client("WeeklyShare"."clientId"));
CREATE POLICY weeklyshare_insert ON "WeeklyShare" FOR INSERT
  WITH CHECK (
    app_can_write_weekly_share("WeeklyShare"."clientId")
    AND "WeeklyShare"."createdById" = current_setting('app.user_id', true)
    AND "WeeklyShare"."updatedById" = current_setting('app.user_id', true)
  );
CREATE POLICY weeklyshare_update ON "WeeklyShare" FOR UPDATE
  USING (app_can_write_weekly_share("WeeklyShare"."clientId"))
  WITH CHECK (
    app_can_write_weekly_share("WeeklyShare"."clientId")
    AND "WeeklyShare"."updatedById" = current_setting('app.user_id', true)
  );

ALTER TABLE "WeeklyOtherWork" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WeeklyOtherWork" FORCE ROW LEVEL SECURITY;
CREATE POLICY weeklyotherwork_select ON "WeeklyOtherWork" FOR SELECT
  USING (
    app_can_see_weekly_author("WeeklyOtherWork"."authorId")
    OR ("WeeklyOtherWork"."supportClientId" IS NOT NULL AND app_can_see_client("WeeklyOtherWork"."supportClientId"))
  );
CREATE POLICY weeklyotherwork_insert ON "WeeklyOtherWork" FOR INSERT
  WITH CHECK (
    current_setting('app.user_role', true) IN ('PM', 'PART_LEADER')
    AND "WeeklyOtherWork"."authorId" = current_setting('app.user_id', true)
  );
CREATE POLICY weeklyotherwork_update ON "WeeklyOtherWork" FOR UPDATE
  USING (
    current_setting('app.user_role', true) IN ('PM', 'PART_LEADER')
    AND "WeeklyOtherWork"."authorId" = current_setting('app.user_id', true)
  )
  WITH CHECK (
    current_setting('app.user_role', true) IN ('PM', 'PART_LEADER')
    AND "WeeklyOtherWork"."authorId" = current_setting('app.user_id', true)
  );
