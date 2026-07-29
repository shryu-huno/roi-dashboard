-- 담당자명/이메일/전화 필드 제거 (고객사 추가·상세 폼에서 삭제)
ALTER TABLE "Client" DROP COLUMN "contactName",
DROP COLUMN "contactEmail",
DROP COLUMN "contactPhone";
