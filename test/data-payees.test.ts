import { describe, it, expect, beforeEach } from "vitest";
import { withRLS } from "@/lib/rls";
import {
  createPayeesBulk, listPayees, listPayeesForExport, findPayeeByBizNumber, parsePayeeSearchField,
  updatePayee, softDeletePayees,
  type PayeeCreateInput,
} from "@/lib/data/payees";
import {
  encrypt, decrypt, blindIndex, maskBizNumber, maskAccountNumber,
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

function input(bizDigits: string, type: "INSTRUCTOR" | "VENDOR", bizName = "이름"): PayeeCreateInput {
  const acct = "110123456789";
  return {
    payeeType: type,
    bizName,
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

  it("listPayees는 계좌번호 원문만 복호화해 반환(사업자번호 원문은 내보내지 않음)", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    const [row] = await listPayees(ADMIN);
    expect(row.accountNumber).toBe("110123456789");
    expect(row.hasBizCert).toBe(false);
    expect(row.hasBankbook).toBe(false);
    // 화면은 마스킹만 쓰므로 원문은 반환 타입에 없다. 암호문 자체가 제대로 복호화되는지는 직접 확인.
    expect(Object.keys(row)).not.toContain("bizNumber");
    const [raw] = await withRLS(ADMIN, (tx) => tx.payee.findMany());
    expect(decrypt(raw.bizNumberEnc)).toBe("1234567890");
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

  it("listPayees: 사업자명은 대소문자 무관 부분일치로 검색된다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR", "Acme")]);
    const hit = await listPayees(ADMIN, { field: "bizName", q: "acme" });
    expect(hit).toHaveLength(1);
    const miss = await listPayees(ADMIN, { field: "bizName", q: "없는이름" });
    expect(miss).toHaveLength(0);
  });

  it("parsePayeeSearchField: 유효한 값은 그대로, 알 수 없는 값은 undefined 반환", () => {
    expect(parsePayeeSearchField("bizNumber")).toBe("bizNumber");
    expect(parsePayeeSearchField("xyz")).toBeUndefined();
    expect(parsePayeeSearchField(undefined)).toBeUndefined();
  });

  it("listPayees: 고유번호는 부분일치로 검색된다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]); // keyId: b001
    const hit = await listPayees(ADMIN, { field: "keyId", q: "b00" });
    expect(hit).toHaveLength(1);
    const miss = await listPayees(ADMIN, { field: "keyId", q: "a99" });
    expect(miss).toHaveLength(0);
  });

  it("listPayees: 사업자번호는 하이픈 유무와 무관하게 부분일치로 검색된다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    const withHyphen = await listPayees(ADMIN, { field: "bizNumber", q: "123-45" });
    expect(withHyphen).toHaveLength(1);
    const withoutHyphen = await listPayees(ADMIN, { field: "bizNumber", q: "34567890" });
    expect(withoutHyphen).toHaveLength(1);
    const miss = await listPayees(ADMIN, { field: "bizNumber", q: "99999" });
    expect(miss).toHaveLength(0);
  });

  it("listPayees: 검색어가 빈 문자열이면 전체 반환", async () => {
    await createPayeesBulk(ADMIN, [
      input("1234567890", "VENDOR"),
      input("9002022345678", "INSTRUCTOR"),
    ]);
    const rows = await listPayees(ADMIN, { field: "bizName", q: "   " });
    expect(rows).toHaveLength(2);
  });

  it("listPayees: 사업자번호 검색어가 6자리를 넘으면 앞 6자리만 사용해 매칭한다", async () => {
    await createPayeesBulk(ADMIN, [input("1234561111", "VENDOR")]);
    const rows = await listPayees(ADMIN, { field: "bizNumber", q: "123456999999" });
    expect(rows).toHaveLength(1);
  });

  it("listPayeesForExport는 사업자번호 원문을 포함해 반환한다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR", "Acme")]);
    const [row] = await listPayeesForExport(ADMIN);
    expect(row.bizNumber).toBe("1234567890");
    expect(row.accountNumber).toBe("110123456789");
    expect(row.keyId).toBe("b001");
    expect(row.bizName).toBe("Acme");
  });

  it("listPayeesForExport도 listPayees와 동일한 검색 필터를 적용한다", async () => {
    await createPayeesBulk(ADMIN, [
      input("1234567890", "VENDOR", "Acme"),
      input("9002022345678", "INSTRUCTOR", "다른이름"),
    ]);
    const hit = await listPayeesForExport(ADMIN, { field: "bizName", q: "acme" });
    expect(hit).toHaveLength(1);
    expect(hit[0].bizName).toBe("Acme");
  });

  it("listPayeesForExport는 SETTLEMENT/ADMIN 외 역할은 거부한다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    await expect(
      listPayeesForExport({ userId: "pm1", role: "PM" }),
    ).rejects.toThrow("지급 리스트 원문 조회 권한이 없습니다.");
  });

  it("updatePayee: 이름/은행명/계좌번호/예금주/청구방식을 갱신한다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR", "Old Name")]);
    const [row] = await listPayees(ADMIN);

    await updatePayee(ADMIN, row.id, {
      bizName: "New Name",
      bankName: "신한은행",
      accountNumber: "999-88-777666",
      accountHolder: "새예금주",
      taxType: "OTHER_INCOME",
    });

    const [after] = await listPayees(ADMIN);
    expect(after.bizName).toBe("New Name");
    expect(after.bankName).toBe("신한은행");
    expect(after.accountNumber).toBe("99988777666");
    expect(after.accountHolder).toBe("새예금주");
    expect(after.taxType).toBe("OTHER_INCOME");

    const raw = await withRLS(ADMIN, (tx) => tx.payee.findUnique({ where: { id: row.id } }));
    expect(raw?.accountNumberMasked).toBe("****7666");
  });

  it("updatePayee는 고유번호·유형·사업자번호(마스킹)를 변경하지 않는다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR", "Old Name")]);
    const [before] = await listPayees(ADMIN);

    await updatePayee(ADMIN, before.id, {
      bizName: "New Name",
      bankName: "신한은행",
      accountNumber: "1101234567890",
      accountHolder: "새예금주",
      taxType: "OTHER_INCOME",
    });

    const [after] = await listPayees(ADMIN);
    expect(after.keyId).toBe(before.keyId);
    expect(after.payeeType).toBe(before.payeeType);
    expect(after.bizNumberMasked).toBe(before.bizNumberMasked);
    expect(after.phone).toBe(before.phone);
  });

  it("updatePayee는 SETTLEMENT/ADMIN 외 역할은 거부한다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    const [row] = await listPayees(ADMIN);

    await expect(
      updatePayee({ userId: "pm1", role: "PM" }, row.id, {
        bizName: "x",
        bankName: "신한은행",
        accountNumber: "1101234567890",
        accountHolder: "y",
        taxType: "OTHER_INCOME",
      }),
    ).rejects.toThrow("지급 리스트 수정 권한이 없습니다.");
  });

  it("listPayees와 listPayeesForExport는 소프트 삭제된 행을 제외한다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    const [row] = await listPayees(ADMIN);

    await withRLS(ADMIN, (tx) =>
      tx.payee.update({ where: { id: row.id }, data: { deletedAt: new Date() } }),
    );

    expect(await listPayees(ADMIN)).toHaveLength(0);
    expect(await listPayeesForExport(ADMIN)).toHaveLength(0);
  });

  it("softDeletePayees: deletedAt을 채우고 listPayees에서 제외한다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    const [row] = await listPayees(ADMIN);

    const res = await softDeletePayees(ADMIN, [row.id]);
    expect(res.ok).toBe(true);

    expect(await listPayees(ADMIN)).toHaveLength(0);
    const raw = await withRLS(ADMIN, (tx) => tx.payee.findUnique({ where: { id: row.id } }));
    expect(raw?.deletedAt).not.toBeNull();
  });

  it("softDeletePayees: 여러 id를 한 번에 삭제한다(일괄 삭제)", async () => {
    await createPayeesBulk(ADMIN, [
      input("1234567890", "VENDOR"),
      input("9002022345678", "INSTRUCTOR"),
    ]);
    const rows = await listPayees(ADMIN);

    const res = await softDeletePayees(ADMIN, rows.map((r) => r.id));
    expect(res.ok).toBe(true);
    expect(await listPayees(ADMIN)).toHaveLength(0);
  });

  it("softDeletePayees: 이미 삭제된 항목을 다시 삭제하면 ok:false", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    const [row] = await listPayees(ADMIN);

    expect((await softDeletePayees(ADMIN, [row.id])).ok).toBe(true);
    const res2 = await softDeletePayees(ADMIN, [row.id]);
    expect(res2.ok).toBe(false);
    expect(res2.error).toBe("삭제할 항목을 찾을 수 없습니다.");
  });

  it("softDeletePayees는 SETTLEMENT/ADMIN 외 역할은 거부한다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    const [row] = await listPayees(ADMIN);

    await expect(
      softDeletePayees({ userId: "pm1", role: "PM" }, [row.id]),
    ).rejects.toThrow("지급 리스트 삭제 권한이 없습니다.");
  });
});
