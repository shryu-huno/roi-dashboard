import { describe, it, expect, vi, beforeEach } from "vitest";

const uploadMock = vi.fn();
const removeMock = vi.fn();
const createSignedUrlMock = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    storage: {
      from: () => ({
        upload: uploadMock,
        remove: removeMock,
        createSignedUrl: createSignedUrlMock,
      }),
    },
  })),
}));

const ENV_BACKUP = { ...process.env };

import {
  StorageConfigError,
  validateAttachmentFile,
  attachmentPath,
  uploadPayeeFile,
  deletePayeeFile,
  signedDownloadUrl,
} from "@/lib/storage/payee-attachments";

function pdfFile(name = "biz.pdf", size = 1024): File {
  return new File([new Uint8Array(size)], name, { type: "application/pdf" });
}

describe("payee-attachments 저장소 헬퍼", () => {
  beforeEach(() => {
    process.env = { ...ENV_BACKUP, SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc-key" };
    uploadMock.mockReset().mockResolvedValue({ error: null });
    removeMock.mockReset().mockResolvedValue({ error: null });
    createSignedUrlMock.mockReset().mockResolvedValue({ data: { signedUrl: "https://signed.example/x" }, error: null });
  });

  it("validateAttachmentFile: PDF/JPG/PNG·10MB 이하는 통과", () => {
    expect(validateAttachmentFile(pdfFile())).toBeNull();
    expect(validateAttachmentFile(new File([new Uint8Array(1)], "a.jpg", { type: "image/jpeg" }))).toBeNull();
    expect(validateAttachmentFile(new File([new Uint8Array(1)], "a.png", { type: "image/png" }))).toBeNull();
  });

  it("validateAttachmentFile: 허용 외 형식은 거부", () => {
    const f = new File([new Uint8Array(1)], "a.hwp", { type: "application/x-hwp" });
    expect(validateAttachmentFile(f)).toBe("PDF, JPG, PNG 파일만 업로드할 수 있습니다.");
  });

  it("validateAttachmentFile: 10MB 초과는 거부", () => {
    const big = pdfFile("big.pdf", 10 * 1024 * 1024 + 1);
    expect(validateAttachmentFile(big)).toBe("파일 크기는 10MB를 초과할 수 없습니다.");
  });

  it("attachmentPath: payeeId/fileType/토큰-파일명 형식", () => {
    const path = attachmentPath("pay1", "BIZ_CERT", "사업자등록증.pdf");
    expect(path).toMatch(/^pay1\/BIZ_CERT\/[0-9a-f]{16}-사업자등록증\.pdf$/);
  });

  it("uploadPayeeFile: 스토리지 upload 호출, 실패 시 에러 던짐", async () => {
    await uploadPayeeFile("pay1/BIZ_CERT/x-a.pdf", pdfFile());
    expect(uploadMock).toHaveBeenCalledWith("pay1/BIZ_CERT/x-a.pdf", expect.anything(), expect.objectContaining({ contentType: "application/pdf" }));

    uploadMock.mockResolvedValueOnce({ error: { message: "boom" } });
    await expect(uploadPayeeFile("pay1/BIZ_CERT/x-a.pdf", pdfFile())).rejects.toThrow("boom");
  });

  it("deletePayeeFile: 스토리지 remove 호출, 실패 시 에러 던짐", async () => {
    await deletePayeeFile("pay1/BIZ_CERT/x-a.pdf");
    expect(removeMock).toHaveBeenCalledWith(["pay1/BIZ_CERT/x-a.pdf"]);

    removeMock.mockResolvedValueOnce({ error: { message: "boom" } });
    await expect(deletePayeeFile("pay1/BIZ_CERT/x-a.pdf")).rejects.toThrow("boom");
  });

  it("signedDownloadUrl: 60초 만료로 서명 URL 요청, 반환", async () => {
    const url = await signedDownloadUrl("pay1/BIZ_CERT/x-a.pdf");
    expect(createSignedUrlMock).toHaveBeenCalledWith("pay1/BIZ_CERT/x-a.pdf", 60);
    expect(url).toBe("https://signed.example/x");
  });

  it("환경변수 누락 시 StorageConfigError", async () => {
    process.env.SUPABASE_URL = "";
    await expect(uploadPayeeFile("x", pdfFile())).rejects.toThrow(StorageConfigError);
  });
});
