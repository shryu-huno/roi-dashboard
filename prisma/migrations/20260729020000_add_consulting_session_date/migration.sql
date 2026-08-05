-- 상담비 라인아이템에 실시일시(sessionDate) 추가.
-- 엑셀 '실시일시'의 날짜부분만 'YYYY-MM-DD' 문자열로 저장(시각 제외). 기존 행은 NULL.
ALTER TABLE "ConsultingExpense" ADD COLUMN "sessionDate" TEXT;
