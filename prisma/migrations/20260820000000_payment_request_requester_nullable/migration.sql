-- PaymentRequest.requester를 선택적으로 전환한다.
-- 신청인(User) 하드 삭제 시 지급요청 레코드(재무 이력)는 보존하되 requesterId만 NULL로 만든다.
-- 기존 FK는 ON DELETE RESTRICT였다 → ON DELETE SET NULL로 재생성.

ALTER TABLE "PaymentRequest" ALTER COLUMN "requesterId" DROP NOT NULL;

ALTER TABLE "PaymentRequest" DROP CONSTRAINT "PaymentRequest_requesterId_fkey";

ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_requesterId_fkey"
  FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
