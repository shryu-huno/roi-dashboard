-- 지급비용(amount)을 선택값으로 전환(엑셀 적재 시 지급비용 미저장 요구 반영).
ALTER TABLE "ConsultingExpense" ALTER COLUMN "amount" DROP NOT NULL;
