-- 기업명(companyName) 컬럼을 고객사명(clientName)으로 통합.
-- 1) 컬럼명 변경: companyName → clientName
ALTER TABLE "ConsultingExpense" RENAME COLUMN "companyName" TO "clientName";

-- 2) 값을 정식 고객사명(Client.name)으로 정규화(엑셀 기업명 표기 차이 제거).
UPDATE "ConsultingExpense" ce
SET "clientName" = c.name
FROM "Client" c
WHERE c.id = ce."clientId" AND ce."clientName" <> c.name;
