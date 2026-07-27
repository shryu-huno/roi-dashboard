import { describe, it, expect } from "vitest";
import {
  encrypt, decrypt, blindIndex, digitsOnly, derivePayeeType, maskBizNumber, maskAccountNumber,
  PayeeKeyConfigError,
} from "@/lib/crypto/payee-secret";

describe("payee-secret", () => {
  it("AES-GCM 암복호화 라운드트립", () => {
    expect(decrypt(encrypt("9001011234567"))).toBe("9001011234567");
  });
  it("같은 평문도 매번 다른 암호문(IV 랜덤)", () => {
    expect(encrypt("x")).not.toBe(encrypt("x"));
  });
  it("블라인드 인덱스는 결정적이고 값마다 다르다", () => {
    expect(blindIndex("1234567890")).toBe(blindIndex("1234567890"));
    expect(blindIndex("1234567890")).not.toBe(blindIndex("9999999999"));
  });
  it("번호 길이로 유형 판별", () => {
    expect(derivePayeeType("9001011234567")).toBe("INSTRUCTOR");
    expect(derivePayeeType("1234567890")).toBe("VENDOR");
    expect(derivePayeeType("123")).toBeNull();
  });
  it("마스킹·정규화 형식", () => {
    expect(maskBizNumber("9001011234567", "INSTRUCTOR")).toBe("900101-1******");
    expect(maskBizNumber("1234567890", "VENDOR")).toBe("123-45-6****");
    expect(maskAccountNumber("110123456789")).toBe("****6789");
    expect(digitsOnly("010-1234-5678")).toBe("01012345678");
  });
  it("키 미설정은 PayeeKeyConfigError로 던져 파일 오류와 구분된다", () => {
    const saved = process.env.PAYEE_ENC_KEY;
    delete process.env.PAYEE_ENC_KEY;
    try {
      expect(() => encrypt("x")).toThrow(PayeeKeyConfigError);
    } finally {
      process.env.PAYEE_ENC_KEY = saved;
    }
  });
});
