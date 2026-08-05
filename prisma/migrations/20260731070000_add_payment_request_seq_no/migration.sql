-- CreateSequence
CREATE SEQUENCE "PaymentRequest_seqNo_seq";

-- AddColumn (nullable 상태로 우선 추가)
ALTER TABLE "PaymentRequest" ADD COLUMN "seqNo" INTEGER;

-- Backfill: 기존 행은 requestedAt 오름차순으로 명시적으로 채번 (Prisma 기본 임의 순서 대신)
UPDATE "PaymentRequest" pr
SET "seqNo" = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "requestedAt", id) AS rn
  FROM "PaymentRequest"
) sub
WHERE pr.id = sub.id;

-- 시퀀스가 백필된 최댓값 다음부터 이어지도록 설정
SELECT setval('"PaymentRequest_seqNo_seq"', COALESCE((SELECT MAX("seqNo") FROM "PaymentRequest"), 0) + 1, false);

-- NOT NULL + 시퀀스 기본값 확정
ALTER TABLE "PaymentRequest" ALTER COLUMN "seqNo" SET NOT NULL;
ALTER TABLE "PaymentRequest" ALTER COLUMN "seqNo" SET DEFAULT nextval('"PaymentRequest_seqNo_seq"');
ALTER SEQUENCE "PaymentRequest_seqNo_seq" OWNED BY "PaymentRequest"."seqNo";

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_seqNo_key" ON "PaymentRequest"("seqNo");
