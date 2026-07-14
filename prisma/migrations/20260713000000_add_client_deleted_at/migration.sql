-- 고객사 소프트 삭제(보관): null=활성, 값=보관됨(목록에서 숨김)
ALTER TABLE "Client" ADD COLUMN     "deletedAt" TIMESTAMP(3);
