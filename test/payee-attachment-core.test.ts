import { describe, it, expect, beforeEach, vi } from "vitest";
import { withRLS } from "@/lib/rls";
import { createPayeesBulk } from "@/lib/data/payees";
import { getPayeeAttachments } from "@/lib/data/payee-attachments";
import { encrypt, blindIndex, maskBizNumber, maskAccountNumber } from "@/lib/crypto/payee-secret";

const ADMIN = { userId: "seed-admin", role: "ADMIN" as const };

const { uploadPayeeFile, deletePayeeFile, signedDownloadUrl } = vi.hoisted(() => ({
  uploadPayeeFile: vi.fn(async () => undefined),
  deletePayeeFile: vi.fn(async () => undefined),
  signedDownloadUrl: vi.fn(async () => "https://signed.example/x"),
}));

vi.mock("@/lib/storage/payee-attachments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/payee-attachments")>();
  return { ...actual, uploadPayeeFile, deletePayeeFile, signedDownloadUrl };
});

import { saveAttachmentsCore, getDownloadUrlCore } from "@/app/(app)/expenses/payees/attachment-core";
import { PAYEE_ATTACHMENT_SAVE_INIT } from "@/app/(app)/expenses/payees/attachment-state";

function pdfFile(name = "a.pdf", size = 1024): File {
  return new File([new Uint8Array(size)], name, { type: "application/pdf" });
}

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
    accountHolder: "예금주",
    taxType: "TAX_INVOICE",
  }]);
  const [row] = await withRLS(ADMIN, (tx) => tx.payee.findMany());
  return row.id;
}

describe("attachment-core", () => {
  let payeeId: string;
  beforeEach(async () => {
    vi.clearAllMocks();
    await reset();
    payeeId = await seedPayee();
  });

  it("saveAttachmentsCore: 신규 업로드 성공 시 storage.upload 호출 + DB 반영 + 성공 상태", async () => {
    const fd = new FormData();
    fd.set("payeeId", payeeId);
    fd.set("bizCertFile", pdfFile("biz.pdf"));

    const result = await saveAttachmentsCore(ADMIN, fd);

    expect(result.ok).toBe(true);
    expect(uploadPayeeFile).toHaveBeenCalledTimes(1);
    const after = await getPayeeAttachments(ADMIN, payeeId);
    expect(after.bizCert?.fileName).toBe("biz.pdf");
  });

  it("saveAttachmentsCore: 교체 시 새 파일 업로드 후 이전 오브젝트 삭제", async () => {
    const fd1 = new FormData();
    fd1.set("payeeId", payeeId);
    fd1.set("bizCertFile", pdfFile("first.pdf"));
    await saveAttachmentsCore(ADMIN, fd1);

    const fd2 = new FormData();
    fd2.set("payeeId", payeeId);
    fd2.set("bizCertFile", pdfFile("second.pdf"));
    const result = await saveAttachmentsCore(ADMIN, fd2);

    expect(result.ok).toBe(true);
    expect(deletePayeeFile).toHaveBeenCalledTimes(1);
    const after = await getPayeeAttachments(ADMIN, payeeId);
    expect(after.bizCert?.fileName).toBe("second.pdf");
  });

  it("saveAttachmentsCore: 교체 시 이전 파일 정리 실패해도 교체 자체는 성공 처리", async () => {
    const fd1 = new FormData();
    fd1.set("payeeId", payeeId);
    fd1.set("bizCertFile", pdfFile("first.pdf"));
    await saveAttachmentsCore(ADMIN, fd1);

    deletePayeeFile.mockRejectedValueOnce(new Error("cleanup boom"));

    const fd2 = new FormData();
    fd2.set("payeeId", payeeId);
    fd2.set("bizCertFile", pdfFile("second.pdf"));
    const result = await saveAttachmentsCore(ADMIN, fd2);

    expect(result).toMatchObject({ ok: true });
    const after = await getPayeeAttachments(ADMIN, payeeId);
    expect(after.bizCert?.fileName).toBe("second.pdf");
  });

  it("saveAttachmentsCore: 삭제 플래그 시 storage 삭제 + DB row 제거", async () => {
    const fd1 = new FormData();
    fd1.set("payeeId", payeeId);
    fd1.set("bizCertFile", pdfFile());
    await saveAttachmentsCore(ADMIN, fd1);

    const fd2 = new FormData();
    fd2.set("payeeId", payeeId);
    fd2.set("bizCertDelete", "true");
    const result = await saveAttachmentsCore(ADMIN, fd2);

    expect(result.ok).toBe(true);
    expect(deletePayeeFile).toHaveBeenCalledTimes(1);
    const after = await getPayeeAttachments(ADMIN, payeeId);
    expect(after.bizCert).toBeNull();
  });

  it("saveAttachmentsCore: 잘못된 형식은 해당 슬롯만 에러, 업로드 호출 안 함", async () => {
    const fd = new FormData();
    fd.set("payeeId", payeeId);
    fd.set("bizCertFile", new File([new Uint8Array(1)], "a.hwp", { type: "application/x-hwp" }));
    const result = await saveAttachmentsCore(ADMIN, fd);

    expect(result.ok).toBe(false);
    expect(result.bizCertError).toBe("PDF, JPG, PNG 파일만 업로드할 수 있습니다.");
    expect(uploadPayeeFile).not.toHaveBeenCalled();
  });

  it("saveAttachmentsCore: 한쪽 슬롯 실패해도 다른 슬롯은 반영", async () => {
    const fd = new FormData();
    fd.set("payeeId", payeeId);
    fd.set("bizCertFile", new File([new Uint8Array(1)], "a.hwp", { type: "application/x-hwp" }));
    fd.set("bankbookFile", pdfFile("bank.pdf"));
    const result = await saveAttachmentsCore(ADMIN, fd);

    expect(result.ok).toBe(false);
    expect(result.bizCertError).toBeTruthy();
    expect(result.bankbookError).toBeUndefined();
    const after = await getPayeeAttachments(ADMIN, payeeId);
    expect(after.bankbook?.fileName).toBe("bank.pdf");
  });

  it("getDownloadUrlCore: 파일 있으면 서명 URL 반환", async () => {
    const fd = new FormData();
    fd.set("payeeId", payeeId);
    fd.set("bizCertFile", pdfFile());
    await saveAttachmentsCore(ADMIN, fd);

    const res = await getDownloadUrlCore(ADMIN, payeeId, "BIZ_CERT");
    expect(res).toEqual({ ok: true, url: "https://signed.example/x" });
  });

  it("getDownloadUrlCore: 파일 없으면 에러", async () => {
    const res = await getDownloadUrlCore(ADMIN, payeeId, "BANKBOOK");
    expect(res).toEqual({ ok: false, error: "파일을 찾을 수 없습니다." });
  });
});
