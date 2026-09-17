-- 고객사명 스냅샷 추가. PM이 담당하지 않는 고객사의 지급요청도 조회할 수 있게 되면서
-- (payment_request_select_all_pm 마이그레이션), Client 조인만으로는 Client RLS에 막혀
-- 고객사명을 읽지 못하는 문제가 생긴다. bizName/bankName 등과 동일하게 등록 시점 값을
-- 스냅샷으로 저장해 Client RLS와 무관하게 항상 표시한다.
ALTER TABLE "PaymentRequest" ADD COLUMN "clientName" TEXT;

UPDATE "PaymentRequest" pr
SET "clientName" = c."name"
FROM "Client" c
WHERE c.id = pr."clientId";

ALTER TABLE "PaymentRequest" ALTER COLUMN "clientName" SET NOT NULL;
