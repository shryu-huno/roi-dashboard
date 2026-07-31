-- 실적 계약 여부(기본 false). true면 목록에서 달성률 대신 "실적 계약"으로 표시한다.
ALTER TABLE "Client" ADD COLUMN "performanceContract" BOOLEAN NOT NULL DEFAULT false;
