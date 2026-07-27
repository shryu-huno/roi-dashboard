import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS } from "@/lib/rls";

const ADMIN = { userId: "seed-admin", role: "ADMIN" as const };

async function reset() {
  await withRLS(ADMIN, async (tx) => {
    await tx.payeeAttachment.deleteMany();
    await tx.payee.deleteMany();
  });
  await prisma.user.deleteMany();
}

function samplePayee(keyId: string) {
  return {
    keyId,
    payeeType: "VENDOR" as const,
    bizName: "테스트업체",
    bizNumberEnc: "enc",
    bizNumberMasked: "123-45-6****",
    bizNumberBidx: "bidx",
    phone: "01012345678",
    phoneNormalized: "01012345678",
    bankName: "국민",
    accountNumberEnc: "enc2",
    accountNumberMasked: "****1234",
    accountHolder: "홍길동",
    taxType: "TAX_INVOICE" as const,
  };
}

describe("Payee RLS — 공용 원장", () => {
  beforeEach(reset);

  it("SETTLEMENT은 등록할 수 있다", async () => {
    const created = await withRLS({ userId: "s1", role: "SETTLEMENT" }, (tx) =>
      tx.payee.create({ data: samplePayee("b001") }),
    );
    expect(created.keyId).toBe("b001");
  });

  it("PM은 전체 원장을 읽을 수 있다(공용)", async () => {
    await withRLS(ADMIN, (tx) => tx.payee.create({ data: samplePayee("b002") }));
    const rows = await withRLS({ userId: "pm1", role: "PM" }, (tx) => tx.payee.findMany());
    expect(rows.length).toBe(1);
  });

  it("PM은 등록할 수 없다(WITH CHECK)", async () => {
    await expect(
      withRLS({ userId: "pm1", role: "PM" }, (tx) => tx.payee.create({ data: samplePayee("b003") })),
    ).rejects.toThrow(/로우 단위 보안 정책|row-level security/i);
  });
});
