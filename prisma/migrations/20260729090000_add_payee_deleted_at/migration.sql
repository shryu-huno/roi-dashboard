-- 지급 대상 소프트 삭제: null=활성, 값=삭제됨(목록에서 숨김)
ALTER TABLE "Payee" ADD COLUMN     "deletedAt" TIMESTAMP(3);
