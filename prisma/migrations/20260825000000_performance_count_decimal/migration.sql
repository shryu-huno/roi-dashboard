-- 실적 횟수(count)를 소수 입력 지원을 위해 정수→배정밀도 실수로 전환(0.6회 등 부분 실적 기록).
-- 금액(amount)은 원 단위 정수로 유지하며, 파생 금액(단가×횟수)은 애플리케이션/재계산 SQL에서 반올림한다.
ALTER TABLE "MonthlyPerformance" ALTER COLUMN "count" TYPE double precision;
