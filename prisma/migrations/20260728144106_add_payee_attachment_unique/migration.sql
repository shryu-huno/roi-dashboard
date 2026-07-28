-- AlterTable
ALTER TABLE "PayeeAttachment" ADD CONSTRAINT "PayeeAttachment_payeeId_fileType_key" UNIQUE ("payeeId", "fileType");
