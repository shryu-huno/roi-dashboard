-- 고객사 청구·보고 주기(복수 선택). 기본값 빈 배열.
ALTER TABLE "Client" ADD COLUMN "billingCycle" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Client" ADD COLUMN "reportCycle" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
