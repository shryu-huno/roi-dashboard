import { describe, it, expect, beforeEach } from "vitest";
import { withRLS } from "@/lib/rls";
import { createPayeesBulk } from "@/lib/data/payees";
import { getPayeeAttachments, upsertPayeeAttachment, deletePayeeAttachment } from "@/lib/data/payee-attachments";
import { encrypt, blindIndex, maskBizNumber, maskAccountNumber } from "@/lib/crypto/payee-secret";

const ADMIN = { userId: "seed-admin", role: "ADMIN" as const };

async function reset() {
  await withRLS(ADMIN, async (tx) => {
    await tx.payeeAttachment.deleteMany();
    await tx.payee.deleteMany();
    await tx.$executeRawUnsafe('ALTER SEQUENCE "payee_key_seq_instructor" RESTART WITH 1');
    await tx.$executeRawUnsafe('ALTER SEQUENCE "payee_key_seq_vendor" RESTART WITH 1');
  });
}

async function seedPayee(): Promise<string> {
  const bizDigits = "1234567890";
  await createPayeesBulk(ADMIN, [{
    payeeType: "VENDOR",
    bizName: "업체A",
    bizNumberEnc: encrypt(bizDigits),
    bizNumberMasked: maskBizNumber(bizDigits, "VENDOR"),
    bizNumberBidx: blindIndex(bizDigits),
    phone: "010-1234-5678",
    phoneNormalized: "01012345678",
    bankName: "국민",
    accountNumberEnc: encrypt("110123456789"),
    accountNumberMasked: maskAccountNumber("110123456789"),
    accountNumberBidx: blindIndex("110123456789"),
    accountHolder: "예금주",
    taxType: "TAX_INVOICE",
  }]);
  const [row] = await withRLS(ADMIN, (tx) => tx.payee.findMany());
  return row.id;
}

describe("payee-attachments 데이터 계층", () => {
  let payeeId: string;
  beforeEach(async () => {
    await reset();
    payeeId = await seedPayee();
  });

  it("첨부가 없으면 둘 다 null", async () => {
    const pair = await getPayeeAttachments(ADMIN, payeeId);
    expect(pair).toEqual({ bizCert: null, bankbook: null });
  });

  it("upsertPayeeAttachment: 신규 생성", async () => {
    const rec = await upsertPayeeAttachment(ADMIN, payeeId, "BIZ_CERT", { fileUrl: "p/1", fileName: "a.pdf" });
    expect(rec.fileName).toBe("a.pdf");
    const pair = await getPayeeAttachments(ADMIN, payeeId);
    expect(pair.bizCert).toMatchObject({ fileUrl: "p/1", fileName: "a.pdf" });
    expect(pair.bankbook).toBeNull();
  });

  it("upsertPayeeAttachment: 같은 fileType 재호출 시 교체(1개 유지)", async () => {
    await upsertPayeeAttachment(ADMIN, payeeId, "BIZ_CERT", { fileUrl: "p/1", fileName: "a.pdf" });
    await upsertPayeeAttachment(ADMIN, payeeId, "BIZ_CERT", { fileUrl: "p/2", fileName: "b.pdf" });
    const pair = await getPayeeAttachments(ADMIN, payeeId);
    expect(pair.bizCert).toMatchObject({ fileUrl: "p/2", fileName: "b.pdf" });
    const all = await withRLS(ADMIN, (tx) => tx.payeeAttachment.findMany({ where: { payeeId, fileType: "BIZ_CERT" } }));
    expect(all).toHaveLength(1);
  });

  it("두 유형은 서로 독립적으로 존재", async () => {
    await upsertPayeeAttachment(ADMIN, payeeId, "BIZ_CERT", { fileUrl: "p/1", fileName: "a.pdf" });
    await upsertPayeeAttachment(ADMIN, payeeId, "BANKBOOK", { fileUrl: "p/2", fileName: "b.pdf" });
    const pair = await getPayeeAttachments(ADMIN, payeeId);
    expect(pair.bizCert?.fileName).toBe("a.pdf");
    expect(pair.bankbook?.fileName).toBe("b.pdf");
  });

  it("deletePayeeAttachment: 해당 유형만 제거", async () => {
    await upsertPayeeAttachment(ADMIN, payeeId, "BIZ_CERT", { fileUrl: "p/1", fileName: "a.pdf" });
    await upsertPayeeAttachment(ADMIN, payeeId, "BANKBOOK", { fileUrl: "p/2", fileName: "b.pdf" });
    await deletePayeeAttachment(ADMIN, payeeId, "BIZ_CERT");
    const pair = await getPayeeAttachments(ADMIN, payeeId);
    expect(pair.bizCert).toBeNull();
    expect(pair.bankbook).not.toBeNull();
  });

  it("deletePayeeAttachment: 없는 걸 지워도 에러 없음", async () => {
    await expect(deletePayeeAttachment(ADMIN, payeeId, "BANKBOOK")).resolves.toBeUndefined();
  });
});
