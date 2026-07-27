import { describe, it, expect, beforeEach } from "vitest";
import { withRLS } from "@/lib/rls";
import {
  createPayeesBulk, listPayees, findPayeeByBizNumber, type PayeeCreateInput,
} from "@/lib/data/payees";
import {
  encrypt, blindIndex, maskBizNumber, maskAccountNumber,
} from "@/lib/crypto/payee-secret";

const ADMIN = { userId: "seed-admin", role: "ADMIN" as const };

async function reset() {
  await withRLS(ADMIN, async (tx) => {
    await tx.payeeAttachment.deleteMany();
    await tx.payee.deleteMany();
    await tx.$executeRawUnsafe('ALTER SEQUENCE "payee_key_seq_instructor" RESTART WITH 1');
    await tx.$executeRawUnsafe('ALTER SEQUENCE "payee_key_seq_vendor" RESTART WITH 1');
  });
}

function input(bizDigits: string, type: "INSTRUCTOR" | "VENDOR"): PayeeCreateInput {
  const acct = "110123456789";
  return {
    payeeType: type,
    bizName: "이름",
    bizNumberEnc: encrypt(bizDigits),
    bizNumberMasked: maskBizNumber(bizDigits, type),
    bizNumberBidx: blindIndex(bizDigits),
    phone: "010-1234-5678",
    phoneNormalized: "01012345678",
    bankName: "국민",
    accountNumberEnc: encrypt(acct),
    accountNumberMasked: maskAccountNumber(acct),
    accountHolder: "예금주",
    taxType: type === "INSTRUCTOR" ? "BUSINESS_INCOME" : "TAX_INVOICE",
  };
}

describe("payees 데이터 계층", () => {
  beforeEach(reset);

  it("강사=a###, 업체=b### 로 유형별 채번", async () => {
    await createPayeesBulk(ADMIN, [
      input("9001011234567", "INSTRUCTOR"),
      input("1234567890", "VENDOR"),
      input("9002022345678", "INSTRUCTOR"),
    ]);
    const rows = await listPayees(ADMIN);
    expect(rows.map((r) => r.keyId).sort()).toEqual(["a001", "a002", "b001"]);
  });

  it("listPayees는 원문을 복호화해 반환", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    const [row] = await listPayees(ADMIN);
    expect(row.bizNumber).toBe("1234567890");
    expect(row.accountNumber).toBe("110123456789");
    expect(row.hasBizCert).toBe(false);
    expect(row.hasBankbook).toBe(false);
  });

  it("findPayeeByBizNumber는 블라인드 인덱스로 정확일치(하이픈 무관)", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    const found = await findPayeeByBizNumber(ADMIN, "123-45-67890");
    expect(found).toHaveLength(1);
  });

  it("기존 DB·파일 내 중복(bizNumberBidx)은 스킵하고 신규만 등록", async () => {
    const r1 = await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    expect(r1).toEqual({ created: 1, skipped: 0 });

    // 같은 번호(DB중복) + 파일내 중복(9002...×2) + 신규 1건(9003...)
    const r2 = await createPayeesBulk(ADMIN, [
      input("1234567890", "VENDOR"),      // DB 중복 → skip
      input("9002022345678", "INSTRUCTOR"),
      input("9002022345678", "INSTRUCTOR"), // 파일내 중복 → skip
      input("9003033456789", "INSTRUCTOR"),
    ]);
    expect(r2).toEqual({ created: 2, skipped: 2 });

    const rows = await listPayees(ADMIN);
    expect(rows).toHaveLength(3); // b001, a001, a002
  });

  it("listPayees는 마스킹 값을 함께 반환", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    const [row] = await listPayees(ADMIN);
    expect(row.bizNumberMasked).toBe("123-45-6****");
  });

  it("같은 bizNumberBidx는 DB unique 제약으로 직접 중복 insert가 거부된다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    await expect(
      withRLS(ADMIN, (tx) => tx.payee.create({ data: { keyId: "b999", ...input("1234567890", "VENDOR") } })),
    ).rejects.toThrow();
  });
});
