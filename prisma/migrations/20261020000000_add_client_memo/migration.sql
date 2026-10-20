-- 고객사 특이사항 메모(이력) 테이블 도입.
-- 담당 PM·관리자가 고객사별로 자유 텍스트 메모를 여러 건 남긴다(작성자·시각 기록).
-- 접근제어(RLS)는 고객사와 동일한 app_can_see_client 헬퍼를 쓴다 → 그 고객사를 볼 수 있는
-- 사용자(담당 PM·소속 파트장·팀 관리자·전체 접근 역할)가 읽기·쓰기 모두 가능.
-- 작성자 계정이 하드 삭제돼도 메모 이력은 보존한다(authorId SET NULL).
--
-- 신규 빈 테이블이라 백필이 없어 앱 컨텍스트 주입은 불필요하다. 테이블 GRANT는
-- supabase-roi-app-role.sql의 ALTER DEFAULT PRIVILEGES가 새 테이블에 자동 부여한다(Invoice와 동일).

-- 1) 테이블 + 인덱스 + FK ------------------------------------------------------
CREATE TABLE "ClientMemo" (
  "id"        TEXT NOT NULL,
  "clientId"  TEXT NOT NULL,
  "authorId"  TEXT,
  "content"   TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientMemo_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ClientMemo_clientId_idx" ON "ClientMemo"("clientId");
CREATE INDEX "ClientMemo_authorId_idx" ON "ClientMemo"("authorId");
ALTER TABLE "ClientMemo" ADD CONSTRAINT "ClientMemo_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientMemo" ADD CONSTRAINT "ClientMemo_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2) RLS: 직접 clientId 보유 테이블 → app_can_see_client 헬퍼(Invoice 패턴) -------
ALTER TABLE "ClientMemo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClientMemo" FORCE ROW LEVEL SECURITY;
CREATE POLICY clientmemo_rls ON "ClientMemo"
  USING (app_can_see_client("ClientMemo"."clientId"))
  WITH CHECK (app_can_see_client("ClientMemo"."clientId"));
