-- 과업 표시 순서(프로젝트 내). 설정 화면의 드래그앤드롭 순서를 저장한다.
ALTER TABLE "Task" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- 기존 과업은 지금까지의 기본 정렬(프로젝트별 과업명 오름차순)을 그대로 유지하도록 backfill한다.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "projectId" ORDER BY "name" ASC) - 1 AS rn
  FROM "Task"
)
UPDATE "Task" t SET "sortOrder" = ranked.rn FROM ranked WHERE t.id = ranked.id;
