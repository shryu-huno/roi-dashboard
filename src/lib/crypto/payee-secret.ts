import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import type { PayeeType } from "@prisma/client";

// 키 환경변수 문제. 호출부가 "파일 형식 오류"와 구분해 안내하려면 타입으로 식별돼야 한다.
export class PayeeKeyConfigError extends Error {}

function encKey(): Buffer {
  const raw = process.env.PAYEE_ENC_KEY;
  if (!raw) throw new PayeeKeyConfigError("PAYEE_ENC_KEY 환경변수가 없습니다.");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new PayeeKeyConfigError("PAYEE_ENC_KEY는 base64 32바이트여야 합니다.");
  return key;
}

function bidxKey(): Buffer {
  const raw = process.env.PAYEE_BIDX_KEY;
  if (!raw) throw new PayeeKeyConfigError("PAYEE_BIDX_KEY 환경변수가 없습니다.");
  const key = Buffer.from(raw, "base64");
  if (key.length < 32) throw new PayeeKeyConfigError("PAYEE_BIDX_KEY는 base64 32바이트 이상이어야 합니다.");
  return key;
}

// AES-256-GCM. 저장형: "ivB64:tagB64:ctB64"
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decrypt(stored: string): string {
  const [ivB64, tagB64, ctB64] = stored.split(":");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("암호문 형식이 올바르지 않습니다.");
  const decipher = createDecipheriv("aes-256-gcm", encKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

// 숫자 외 문자 제거(하이픈·공백 등).
export function digitsOnly(v: string): string {
  return v.replace(/\D/g, "");
}

// HMAC-SHA256 블라인드 인덱스. 입력은 digitsOnly로 정규화해서 넣는다(정확일치 검색용).
export function blindIndex(normalized: string): string {
  return createHmac("sha256", bidxKey()).update(normalized).digest("base64");
}

// 번호 길이로 강사(13=주민)/업체(10=사업자) 판별. 그 외는 null.
export function derivePayeeType(bizNumberDigits: string): PayeeType | null {
  if (bizNumberDigits.length === 13) return "INSTRUCTOR";
  if (bizNumberDigits.length === 10) return "VENDOR";
  return null;
}

// 주민번호 900101-1****** / 사업자번호 123-45-6****
export function maskBizNumber(digits: string, type: PayeeType): string {
  if (type === "INSTRUCTOR") {
    return `${digits.slice(0, 6)}-${digits.slice(6, 7)}******`;
  }
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5, 6)}****`;
}

// 계좌번호: 뒤 4자리만 노출.
export function maskAccountNumber(digits: string): string {
  return `****${digits.slice(-4)}`;
}
