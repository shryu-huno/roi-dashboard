import type { PayeeFileType } from "@prisma/client";
import { withRLS, type RlsContext } from "@/lib/rls";

export type PayeeAttachmentRecord = { id: string; fileUrl: string; fileName: string };
export type PayeeAttachmentPair = { bizCert: PayeeAttachmentRecord | null; bankbook: PayeeAttachmentRecord | null };

export function getPayeeAttachments(ctx: RlsContext, payeeId: string): Promise<PayeeAttachmentPair> {
  return withRLS(ctx, async (tx) => {
    const rows = await tx.payeeAttachment.findMany({ where: { payeeId } });
    const bizCert = rows.find((r) => r.fileType === "BIZ_CERT") ?? null;
    const bankbook = rows.find((r) => r.fileType === "BANKBOOK") ?? null;
    return {
      bizCert: bizCert ? { id: bizCert.id, fileUrl: bizCert.fileUrl, fileName: bizCert.fileName } : null,
      bankbook: bankbook ? { id: bankbook.id, fileUrl: bankbook.fileUrl, fileName: bankbook.fileName } : null,
    };
  });
}

export function upsertPayeeAttachment(
  ctx: RlsContext,
  payeeId: string,
  fileType: PayeeFileType,
  data: { fileUrl: string; fileName: string },
): Promise<PayeeAttachmentRecord> {
  return withRLS(ctx, (tx) =>
    tx.payeeAttachment.upsert({
      where: { payeeId_fileType: { payeeId, fileType } },
      create: { payeeId, fileType, fileUrl: data.fileUrl, fileName: data.fileName },
      update: { fileUrl: data.fileUrl, fileName: data.fileName, uploadedAt: new Date() },
    }),
  );
}

export async function deletePayeeAttachment(ctx: RlsContext, payeeId: string, fileType: PayeeFileType): Promise<void> {
  await withRLS(ctx, (tx) => tx.payeeAttachment.deleteMany({ where: { payeeId, fileType } }));
}
