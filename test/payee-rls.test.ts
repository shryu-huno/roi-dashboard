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

  it("PM도 등록할 수 있다(INSERT 정책 확장)", async () => {
    const created = await withRLS({ userId: "pm1", role: "PM" }, (tx) =>
      tx.payee.create({ data: samplePayee("b003") }),
    );
    expect(created.keyId).toBe("b003");
  });

  it("PM은 수정할 수 있다(UPDATE 정책 확장)", async () => {
    const created = await withRLS(ADMIN, (tx) => tx.payee.create({ data: samplePayee("b004") }));
    const updated = await withRLS({ userId: "pm1", role: "PM" }, (tx) =>
      tx.payee.update({ where: { id: created.id }, data: { bizName: "PM이 수정" } }),
    );
    expect(updated.bizName).toBe("PM이 수정");
  });

  it("PM은 여전히 삭제(SQL DELETE)할 수 없다(권한 없음으로 거부됨)", async () => {
    const created = await withRLS(ADMIN, (tx) => tx.payee.create({ data: samplePayee("b005") }));
    // RLS가 DELETE를 막으면 대상 row가 0개로 매치되고, Prisma Client는 이를 조용한 no-op이 아니라
    // P2025("No record was found for a delete") 에러로 던진다 — 이 거부 자체가 차단됐다는 증거다.
    await expect(
      withRLS({ userId: "pm1", role: "PM" }, (tx) => tx.payee.delete({ where: { id: created.id } })),
    ).rejects.toThrow(/no record was found for a delete/i);
    const stillThere = await withRLS(ADMIN, (tx) => tx.payee.findUnique({ where: { id: created.id } }));
    expect(stillThere).not.toBeNull();
  });

  it("PM은 첨부파일을 업로드/교체할 수 있지만(INSERT/UPDATE) 삭제는 할 수 없다(DELETE, 권한 없음으로 거부됨)", async () => {
    const payee = await withRLS(ADMIN, (tx) => tx.payee.create({ data: samplePayee("b006") }));
    const attachment = {
      payeeId: payee.id,
      fileType: "BIZ_CERT" as const,
      fileUrl: "path/to/file.pdf",
      fileName: "b006_테스트업체_사업자등록증.pdf",
    };

    const created = await withRLS({ userId: "pm1", role: "PM" }, (tx) => tx.payeeAttachment.create({ data: attachment }));
    expect(created.fileName).toBe(attachment.fileName);

    const updated = await withRLS({ userId: "pm1", role: "PM" }, (tx) =>
      tx.payeeAttachment.update({ where: { id: created.id }, data: { fileName: "변경됨.pdf" } }),
    );
    expect(updated.fileName).toBe("변경됨.pdf");

    // RLS가 DELETE를 막으면 대상 row가 0개로 매치되고, Prisma Client는 이를 조용한 no-op이 아니라
    // P2025("No record was found for a delete") 에러로 던진다 — 이 거부 자체가 차단됐다는 증거다.
    await expect(
      withRLS({ userId: "pm1", role: "PM" }, (tx) => tx.payeeAttachment.delete({ where: { id: created.id } })),
    ).rejects.toThrow(/no record was found for a delete/i);
    const stillThere = await withRLS(ADMIN, (tx) => tx.payeeAttachment.findUnique({ where: { id: created.id } }));
    expect(stillThere).not.toBeNull();
  });
});
