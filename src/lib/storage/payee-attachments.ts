import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { PayeeFileType } from "@prisma/client";

export class StorageConfigError extends Error {}

const BUCKET = "payee-attachments";
export const ALLOWED_MIME = new Set(["application/pdf", "image/jpeg", "image/png"]);
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

function client() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new StorageConfigError("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// 사업자등록증/통장사본은 PDF·이미지 스캔본이 일반적이라 형식·크기를 제한한다.
export function validateAttachmentFile(file: File): string | null {
  if (!ALLOWED_MIME.has(file.type)) return "PDF, JPG, PNG 파일만 업로드할 수 있습니다.";
  if (file.size > MAX_FILE_SIZE) return "파일 크기는 10MB를 초과할 수 없습니다.";
  return null;
}

// 충돌 방지용 랜덤 토큰을 파일명 앞에 붙인다.
export function attachmentPath(payeeId: string, fileType: PayeeFileType, fileName: string): string {
  const token = randomBytes(8).toString("hex");
  return `${payeeId}/${fileType}/${token}-${fileName}`;
}

export async function uploadPayeeFile(path: string, file: File): Promise<void> {
  const { error } = await client().storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw new Error(error.message);
}

export async function deletePayeeFile(path: string): Promise<void> {
  const { error } = await client().storage.from(BUCKET).remove([path]);
  if (error) throw new Error(error.message);
}

export async function signedDownloadUrl(path: string): Promise<string> {
  const { data, error } = await client().storage.from(BUCKET).createSignedUrl(path, 60);
  if (error || !data) throw new Error(error?.message ?? "서명 URL 발급 실패");
  return data.signedUrl;
}
