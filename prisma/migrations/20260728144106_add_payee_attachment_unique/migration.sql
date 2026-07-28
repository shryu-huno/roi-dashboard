-- CreateIndex
CREATE UNIQUE INDEX "PayeeAttachment_payeeId_fileType_key" ON "PayeeAttachment"("payeeId", "fileType");
