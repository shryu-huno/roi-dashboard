-- 실적 횟수(count)를 선택값으로 전환(과업별 횟수/금액 택일 입력 지원, 금액 직접입력 시 count=null).
ALTER TABLE "MonthlyPerformance" ALTER COLUMN "count" DROP NOT NULL;
