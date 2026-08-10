-- 고객사 아래 "프로젝트" 계층 도입.
-- Client이 직접 갖던 청구·보고 주기, 계약기간, 실적계약 여부, 과업(Task)을 Project로 이동한다.
-- 재무 데이터(청구·입금·지출·성과)는 고객사 단위로 유지한다.
-- RLS는 기존과 동일하게 ClientManager(고객사↔PM) 기준을 유지하고, 신규 테이블에만 정책을 추가한다.

-- 0) 백필용 앱 컨텍스트. Client/Task는 FORCE ROW LEVEL SECURITY이므로, 마이그레이션 연결이
--    슈퍼유저가 아니면(roi_app 등) app.user_role 없이는 기존 행을 읽지 못해 백필이 0건이 된다.
--    ADMIN 컨텍스트를 주입해 기존 정책이 백필 SELECT/UPDATE를 허용하게 한다(SET LOCAL = 트랜잭션 한정).
SELECT set_config('app.user_role', 'ADMIN', true), set_config('app.user_id', 'migration', true);

-- 1) 신규 테이블 --------------------------------------------------------------
CREATE TABLE "Project" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT '진행중',
  "contractStart" TIMESTAMP(3),
  "contractEnd" TIMESTAMP(3),
  "billingCycle" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "reportCycle" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "performanceContract" BOOLEAN NOT NULL DEFAULT false,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Project_clientId_idx" ON "Project"("clientId");
ALTER TABLE "Project" ADD CONSTRAINT "Project_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProjectManager" (
  "projectId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  CONSTRAINT "ProjectManager_pkey" PRIMARY KEY ("projectId", "userId")
);
CREATE INDEX "ProjectManager_userId_idx" ON "ProjectManager"("userId");
ALTER TABLE "ProjectManager" ADD CONSTRAINT "ProjectManager_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectManager" ADD CONSTRAINT "ProjectManager_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2) 백필: 고객사마다 "기본 프로젝트" 1개 생성 (기존 주기·계약기간·실적계약 이관) ----
INSERT INTO "Project" (
  "id", "clientId", "name", "status",
  "contractStart", "contractEnd", "billingCycle", "reportCycle", "performanceContract",
  "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text, c."id", '기본 프로젝트', '진행중',
  c."contractStart", c."contractEnd", c."billingCycle", c."reportCycle", c."performanceContract",
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Client" c;

-- 3) 기존 담당 PM(ClientManager)을 각 고객사 기본 프로젝트의 ProjectManager로 복사 ----
INSERT INTO "ProjectManager" ("projectId", "userId")
SELECT p."id", cm."userId"
FROM "ClientManager" cm
JOIN "Project" p ON p."clientId" = cm."clientId";

-- 4) Task.projectId 추가 → 각 task를 자기 고객사의 기본 프로젝트로 백필 → NOT NULL ----
ALTER TABLE "Task" ADD COLUMN "projectId" TEXT;
UPDATE "Task" t
SET "projectId" = p."id"
FROM "Project" p
WHERE p."clientId" = t."clientId";
ALTER TABLE "Task" ALTER COLUMN "projectId" SET NOT NULL;
CREATE INDEX "Task_projectId_idx" ON "Task"("projectId");
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5) Client에서 이동한 컬럼 제거(백필 후) --------------------------------------
ALTER TABLE "Client"
  DROP COLUMN "billingCycle",
  DROP COLUMN "reportCycle",
  DROP COLUMN "performanceContract",
  DROP COLUMN "contractStart",
  DROP COLUMN "contractEnd";

-- 6) RLS: 신규 테이블도 "PM은 자신이 담당하는 고객사(ClientManager)의 행만" -------
--    business 테이블 정책과 동일한 방식(PUBLIC 대상, current_setting 사용).
--    테이블 GRANT는 supabase-roi-app-role.sql의 ALTER DEFAULT PRIVILEGES가 자동 부여.
ALTER TABLE "Project" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Project" FORCE ROW LEVEL SECURITY;
CREATE POLICY project_rls ON "Project"
  USING (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (SELECT 1 FROM "ClientManager" cm WHERE cm."clientId" = "Project"."clientId" AND cm."userId" = current_setting('app.user_id', true))
  )
  WITH CHECK (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (SELECT 1 FROM "ClientManager" cm WHERE cm."clientId" = "Project"."clientId" AND cm."userId" = current_setting('app.user_id', true))
  );

ALTER TABLE "ProjectManager" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectManager" FORCE ROW LEVEL SECURITY;
CREATE POLICY projectmanager_rls ON "ProjectManager"
  USING (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (
      SELECT 1 FROM "Project" p
      JOIN "ClientManager" cm ON cm."clientId" = p."clientId"
      WHERE p."id" = "ProjectManager"."projectId"
        AND cm."userId" = current_setting('app.user_id', true)
    )
  )
  WITH CHECK (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
  );
