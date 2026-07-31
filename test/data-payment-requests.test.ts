import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS } from "@/lib/rls";
import {
  listPaymentRequests, parsePaymentRequestPage, parsePaymentRequestEntity,
  parsePaymentRequestStatus, parsePaymentRequestDateParam, PAYMENT_REQUEST_PAGE_SIZE,
  createPaymentRequestsBulk, listPaymentRequestsForExport, updatePaymentRequestsBulk,
} from "@/lib/data/payment-requests";
import type { PaymentRequestCreateInput } from "@/lib/payment-request-validation";
import { createPayeesBulk } from "@/lib/data/payees";
import { encrypt, blindIndex, maskBizNumber, maskAccountNumber } from "@/lib/crypto/payee-secret";

const ADMIN = { userId: "seed-admin", role: "ADMIN" as const };

async function reset() {
  await withRLS(ADMIN, async (tx) => {
    await tx.paymentRequest.deleteMany();
    await tx.payeeAttachment.deleteMany();
    await tx.payee.deleteMany();
    await tx.client.deleteMany();
    await tx.$executeRawUnsafe('ALTER SEQUENCE "payee_key_seq_instructor" RESTART WITH 1');
    await tx.$executeRawUnsafe('ALTER SEQUENCE "payee_key_seq_vendor" RESTART WITH 1');
  });
  await prisma.user.deleteMany();
}

async function seed() {
  const admin = await prisma.user.create({ data: { email: "admin@huno.kr", role: "ADMIN", status: "ACTIVE" } });
  const pmA = await prisma.user.create({ data: { email: "pma@huno.kr", name: "김PM", role: "PM", status: "ACTIVE" } });
  const pmB = await prisma.user.create({ data: { email: "pmb@huno.kr", name: "이PM", role: "PM", status: "ACTIVE" } });
  const clientA = await withRLS(ADMIN, (tx) => tx.client.create({
    data: { name: "A사", businessType: "휴노", managers: { create: [{ userId: pmA.id }] } },
  }));
  const clientB = await withRLS(ADMIN, (tx) => tx.client.create({
    data: { name: "B사", businessType: "휴노INC", managers: { create: [{ userId: pmB.id }] } },
  }));
  return { admin, pmA, pmB, clientA, clientB };
}

function payeeInput(bizDigits: string, bizName: string, taxType: "TAX_INVOICE" | "BUSINESS_INCOME" = "TAX_INVOICE") {
  const acct = "110123456789";
  return {
    payeeType: "VENDOR" as const,
    bizName,
    bizNumberEnc: encrypt(bizDigits),
    bizNumberMasked: maskBizNumber(bizDigits, "VENDOR"),
    bizNumberBidx: blindIndex(bizDigits),
    phone: "010-1234-5678",
    phoneNormalized: "01012345678",
    bankName: "국민",
    accountNumberEnc: encrypt(acct),
    accountNumberMasked: maskAccountNumber(acct),
    accountHolder: "예금주",
    taxType,
  };
}

async function createPayee(bizDigits: string, bizName: string, taxType?: "TAX_INVOICE" | "BUSINESS_INCOME") {
  await createPayeesBulk(ADMIN, [payeeInput(bizDigits, bizName, taxType)]);
  const [payee] = await withRLS(ADMIN, (tx) => tx.payee.findMany({ where: { bizName } }));
  return payee;
}

function baseInput(overrides: Partial<{
  requesterId: string; entity: "HUNO" | "HUNO_INC"; clientId: string; bizName: string;
  unitPrice: number; transportFee: number; materialFee: number; count: number;
  taxType: "TAX_INVOICE" | "BUSINESS_INCOME"; memo: string; payDate: Date | null; status: "PREPARING" | "COMPLETED";
}>) {
  return {
    requesterId: overrides.requesterId!,
    entity: overrides.entity ?? "HUNO",
    clientId: overrides.clientId!,
    bizName: overrides.bizName ?? "홍길동",
    unitPrice: overrides.unitPrice ?? 100000,
    transportFee: overrides.transportFee ?? 0,
    materialFee: overrides.materialFee ?? 0,
    count: overrides.count ?? 1,
    amount: ((overrides.unitPrice ?? 100000) + (overrides.transportFee ?? 0) + (overrides.materialFee ?? 0)) * (overrides.count ?? 1),
    taxType: overrides.taxType ?? "BUSINESS_INCOME",
    memo: overrides.memo ?? "테스트 지급요청",
    payDate: overrides.payDate ?? null,
    status: overrides.status ?? "PREPARING",
  };
}

describe("payment-requests 데이터 계층", () => {
  beforeEach(reset);
  // paymentRequest는 client/payee/user를 참조하므로, 이 파일의 마지막 테스트가 남긴 행이
  // 다른 테스트 파일의 reset()(client/user를 지움)을 FK 위반으로 깨뜨린다 — 파일 종료 시에도 정리한다.
  afterAll(reset);

  it("ADMIN은 전체 지급요청을 조회한다", async () => {
    const { admin, pmA, clientA, clientB } = await seed();
    await withRLS(ADMIN, (tx) => tx.paymentRequest.create({ data: baseInput({ requesterId: pmA.id, clientId: clientA.id }) }));
    await withRLS(ADMIN, (tx) => tx.paymentRequest.create({ data: baseInput({ requesterId: admin.id, clientId: clientB.id }) }));
    const { rows, totalPages } = await listPaymentRequests(ADMIN);
    expect(rows.length).toBe(2);
    expect(totalPages).toBe(1);
  });

  it("PM은 자신이 담당하는 고객사의 지급요청만 조회한다(RLS)", async () => {
    const { pmA, pmB, clientA, clientB } = await seed();
    await withRLS(ADMIN, (tx) => tx.paymentRequest.create({ data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "A사건" }) }));
    await withRLS(ADMIN, (tx) => tx.paymentRequest.create({ data: baseInput({ requesterId: pmB.id, clientId: clientB.id, bizName: "B사건" }) }));
    const { rows } = await listPaymentRequests({ userId: pmA.id, role: "PM" });
    expect(rows.map((r) => r.bizName)).toEqual(["A사건"]);
  });

  it("신청인 이름과 고객사명을 조인해서 반환한다", async () => {
    const { pmA, clientA } = await seed();
    await withRLS(ADMIN, (tx) => tx.paymentRequest.create({ data: baseInput({ requesterId: pmA.id, clientId: clientA.id }) }));
    const { rows: [row] } = await listPaymentRequests(ADMIN);
    expect(row.requesterName).toBe("김PM");
    expect(row.clientName).toBe("A사");
  });

  it("seqNo는 자동으로, 유일하게 채번된다", async () => {
    const { pmA, clientA } = await seed();
    const r1 = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
      data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "A건" }),
    }));
    const r2 = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
      data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "B건" }),
    }));
    expect(r1.seqNo).toBeGreaterThan(0);
    expect(r2.seqNo).toBeGreaterThan(r1.seqNo);

    const { rows } = await listPaymentRequests(ADMIN);
    const bySeqNo = new Map(rows.map((r) => [r.bizName, r.seqNo]));
    expect(bySeqNo.get("A건")).toBe(r1.seqNo);
    expect(bySeqNo.get("B건")).toBe(r2.seqNo);
  });

  it("고객사/지급명의/지급여부/사업자명 필터가 동작한다", async () => {
    const { pmA, clientA, clientB } = await seed();
    await withRLS(ADMIN, (tx) => tx.paymentRequest.create({ data: baseInput({ requesterId: pmA.id, clientId: clientA.id, entity: "HUNO", bizName: "홍길동", status: "PREPARING" }) }));
    await withRLS(ADMIN, (tx) => tx.paymentRequest.create({ data: baseInput({ requesterId: pmA.id, clientId: clientB.id, entity: "HUNO_INC", bizName: "김철수", status: "COMPLETED" }) }));

    expect((await listPaymentRequests(ADMIN, { clientId: clientA.id })).rows).toHaveLength(1);
    expect((await listPaymentRequests(ADMIN, { entity: "HUNO_INC" })).rows).toHaveLength(1);
    expect((await listPaymentRequests(ADMIN, { status: "COMPLETED" })).rows[0].bizName).toBe("김철수");
    expect((await listPaymentRequests(ADMIN, { bizName: "길동" })).rows).toHaveLength(1);
  });

  it("지급일 기간 필터는 payDate가 없는 건을 제외한다", async () => {
    const { pmA, clientA } = await seed();
    await withRLS(ADMIN, (tx) => tx.paymentRequest.create({ data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "미지급", payDate: null }) }));
    await withRLS(ADMIN, (tx) => tx.paymentRequest.create({ data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "8월지급", payDate: new Date("2026-08-05") }) }));

    const { rows } = await listPaymentRequests(ADMIN, {
      payDateFrom: new Date("2026-08-01"),
      payDateTo: new Date("2026-08-31"),
    });
    expect(rows.map((r) => r.bizName)).toEqual(["8월지급"]);
  });

  it("페이지네이션: PAGE_SIZE+1건이면 2페이지로 나뉜다", async () => {
    const { pmA, clientA } = await seed();
    await withRLS(ADMIN, async (tx) => {
      for (let i = 0; i < PAYMENT_REQUEST_PAGE_SIZE + 1; i++) {
        await tx.paymentRequest.create({ data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: `건${i}` }) });
      }
    });
    const page1 = await listPaymentRequests(ADMIN, undefined, 1);
    expect(page1.rows).toHaveLength(PAYMENT_REQUEST_PAGE_SIZE);
    expect(page1.totalPages).toBe(2);
    const page2 = await listPaymentRequests(ADMIN, undefined, 2);
    expect(page2.rows).toHaveLength(1);
  });

  it("RLS: PM은 담당하는 고객사에만 등록(INSERT)할 수 있다", async () => {
    const { pmA, clientA } = await seed();
    const created = await withRLS({ userId: pmA.id, role: "PM" }, (tx) =>
      tx.paymentRequest.create({ data: baseInput({ requesterId: pmA.id, clientId: clientA.id }) }),
    );
    expect(created.clientId).toBe(clientA.id);
  });

  it("RLS: PM은 담당하지 않는 고객사에는 등록(INSERT)할 수 없다", async () => {
    const { pmA, clientB } = await seed();
    await expect(
      withRLS({ userId: pmA.id, role: "PM" }, (tx) =>
        tx.paymentRequest.create({ data: baseInput({ requesterId: pmA.id, clientId: clientB.id }) }),
      ),
    ).rejects.toThrow(/로우 단위 보안 정책|row-level security/i);
  });

  it("RLS: PM은 본인이 신청한 건만 수정(UPDATE)할 수 있다", async () => {
    const { pmA, pmB, clientA, clientB } = await seed();
    const ownRow = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({ data: baseInput({ requesterId: pmA.id, clientId: clientA.id }) }));
    const othersRow = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({ data: baseInput({ requesterId: pmB.id, clientId: clientB.id }) }));

    const updated = await withRLS({ userId: pmA.id, role: "PM" }, (tx) =>
      tx.paymentRequest.update({ where: { id: ownRow.id }, data: { memo: "PM이 수정" } }),
    );
    expect(updated.memo).toBe("PM이 수정");

    await expect(
      withRLS({ userId: pmA.id, role: "PM" }, (tx) =>
        tx.paymentRequest.update({ where: { id: othersRow.id }, data: { memo: "해킹 시도" } }),
      ),
    ).rejects.toThrow(/no record was found for an update/i);
  });

  it("RLS: PM은 본인이 신청한 건의 clientId를 담당하지 않는 고객사로 바꿀 수 없다", async () => {
    const { pmA, clientA, clientB } = await seed();
    const ownRow = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({ data: baseInput({ requesterId: pmA.id, clientId: clientA.id }) }));

    await expect(
      withRLS({ userId: pmA.id, role: "PM" }, (tx) =>
        tx.paymentRequest.update({ where: { id: ownRow.id }, data: { clientId: clientB.id } }),
      ),
    ).rejects.toThrow(/로우 단위 보안 정책|row-level security/i);

    const updated = await withRLS({ userId: pmA.id, role: "PM" }, (tx) =>
      tx.paymentRequest.update({ where: { id: ownRow.id }, data: { memo: "clientId는 안 건드리고 수정" } }),
    );
    expect(updated.memo).toBe("clientId는 안 건드리고 수정");
    expect(updated.clientId).toBe(clientA.id);
  });

  it("페이지네이션: requestedAt이 동일한 행들도 중복/누락 없이 페이지네이션된다", async () => {
    const { pmA, clientA } = await seed();
    const total = PAYMENT_REQUEST_PAGE_SIZE + 5;
    // 다건 등록 화면처럼 한 트랜잭션에서 여러 건이 생성되면 requestedAt이 동일해질 수 있다
    // (Postgres CURRENT_TIMESTAMP는 트랜잭션 단위). 정렬 동점을 재현하기 위해 명시적으로 같은
    // 값을 지정해 id 보조 정렬키 없이는 skip/take 페이지네이션이 깨짐을 검증한다.
    const sharedRequestedAt = new Date("2026-07-01T00:00:00.000Z");
    const created = await withRLS(ADMIN, async (tx) => {
      const rows = [];
      for (let i = 0; i < total; i++) {
        rows.push(await tx.paymentRequest.create({
          data: { ...baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: `동시건${i}` }), requestedAt: sharedRequestedAt },
        }));
      }
      return rows;
    });
    expect(new Set(created.map((r) => r.requestedAt.getTime())).size).toBe(1);

    const page1 = await listPaymentRequests(ADMIN, undefined, 1);
    const page2 = await listPaymentRequests(ADMIN, undefined, 2);
    const allIds = [...page1.rows.map((r) => r.id), ...page2.rows.map((r) => r.id)];
    expect(allIds.length).toBe(total);
    expect(new Set(allIds).size).toBe(total);
    expect(new Set(allIds)).toEqual(new Set(created.map((r) => r.id)));
  });

  it("RLS: SETTLEMENT은 고객사·신청인 무관하게 등록·수정할 수 있다", async () => {
    const { pmA, clientA } = await seed();
    const SETTLEMENT = { userId: "s1", role: "SETTLEMENT" as const };
    const created = await withRLS(SETTLEMENT, (tx) => tx.paymentRequest.create({ data: baseInput({ requesterId: pmA.id, clientId: clientA.id }) }));
    const updated = await withRLS(SETTLEMENT, (tx) => tx.paymentRequest.update({ where: { id: created.id }, data: { status: "COMPLETED" } }));
    expect(updated.status).toBe("COMPLETED");
  });

  it("parsePaymentRequestPage: 0/음수/문자/undefined는 1로 클램프", () => {
    expect(parsePaymentRequestPage(undefined)).toBe(1);
    expect(parsePaymentRequestPage("0")).toBe(1);
    expect(parsePaymentRequestPage("-3")).toBe(1);
    expect(parsePaymentRequestPage("abc")).toBe(1);
    expect(parsePaymentRequestPage("2")).toBe(2);
  });

  it("parsePaymentRequestEntity/Status: 알 수 없는 값은 undefined", () => {
    expect(parsePaymentRequestEntity("HUNO")).toBe("HUNO");
    expect(parsePaymentRequestEntity("HACKED")).toBeUndefined();
    expect(parsePaymentRequestStatus("COMPLETED")).toBe("COMPLETED");
    expect(parsePaymentRequestStatus("")).toBeUndefined();
  });

  it("parsePaymentRequestDateParam: YYYY-MM-DD만 파싱, 그 외는 undefined", () => {
    expect(parsePaymentRequestDateParam("2026-08-05")?.toISOString().slice(0, 10)).toBe("2026-08-05");
    expect(parsePaymentRequestDateParam("")).toBeUndefined();
    expect(parsePaymentRequestDateParam("not-a-date")).toBeUndefined();
    expect(parsePaymentRequestDateParam(undefined)).toBeUndefined();
  });

  describe("createPaymentRequestsBulk", () => {
    it("선택한 사업자의 bizName/taxType을 스냅샷으로 저장하고 지급액을 서버가 재계산한다", async () => {
      const { pmA, clientA } = await seed();
      const payee = await createPayee("1234567890", "업체A", "TAX_INVOICE");
      const input: PaymentRequestCreateInput = {
        entity: "HUNO", clientId: clientA.id, payeeId: payee.id,
        unitPrice: 100000, transportFee: 5000, materialFee: 2000, count: 3, memo: "테스트",
      };
      const result = await createPaymentRequestsBulk({ userId: pmA.id, role: "PM" }, pmA.id, [input]);
      expect(result.ok).toBe(true);

      const { rows } = await listPaymentRequests(ADMIN);
      expect(rows).toHaveLength(1);
      expect(rows[0].bizName).toBe("업체A");
      expect(rows[0].taxType).toBe("TAX_INVOICE");
      expect(rows[0].amount).toBe((100000 + 5000 + 2000) * 3);
    });

    it("존재하지 않는 payeeId가 섞여 있으면 전체 저장을 거부한다(all-or-nothing)", async () => {
      const { pmA, clientA } = await seed();
      const payee = await createPayee("1234567890", "업체A");
      const inputs: PaymentRequestCreateInput[] = [
        { entity: "HUNO", clientId: clientA.id, payeeId: payee.id, unitPrice: 10000, transportFee: 0, materialFee: 0, count: 1, memo: "" },
        { entity: "HUNO", clientId: clientA.id, payeeId: "존재하지않는아이디", unitPrice: 10000, transportFee: 0, materialFee: 0, count: 1, memo: "" },
      ];
      const result = await createPaymentRequestsBulk({ userId: pmA.id, role: "PM" }, pmA.id, inputs);
      expect(result.ok).toBe(false);
      expect((await listPaymentRequests(ADMIN)).rows).toHaveLength(0);
    });

    it("소프트 삭제된 사업자로는 저장할 수 없다", async () => {
      const { pmA, clientA } = await seed();
      const payee = await createPayee("1234567890", "삭제된업체");
      await withRLS(ADMIN, (tx) => tx.payee.update({ where: { id: payee.id }, data: { deletedAt: new Date() } }));

      const result = await createPaymentRequestsBulk(
        { userId: pmA.id, role: "PM" }, pmA.id,
        [{ entity: "HUNO", clientId: clientA.id, payeeId: payee.id, unitPrice: 10000, transportFee: 0, materialFee: 0, count: 1, memo: "" }],
      );
      expect(result.ok).toBe(false);
    });

    it("PM이 담당하지 않는 고객사로 저장을 시도하면 RLS로 거부된다", async () => {
      const { pmA, clientB } = await seed();
      const payee = await createPayee("1234567890", "업체A");
      await expect(
        createPaymentRequestsBulk(
          { userId: pmA.id, role: "PM" }, pmA.id,
          [{ entity: "HUNO", clientId: clientB.id, payeeId: payee.id, unitPrice: 10000, transportFee: 0, materialFee: 0, count: 1, memo: "" }],
        ),
      ).rejects.toThrow(/로우 단위 보안 정책|row-level security/i);
    });

    it("여러 행을 한 번에 저장한다", async () => {
      const { pmA, clientA } = await seed();
      const payeeA = await createPayee("1111111111", "업체1");
      const payeeB = await createPayee("2222222222", "업체2");
      const result = await createPaymentRequestsBulk(
        { userId: pmA.id, role: "PM" }, pmA.id,
        [
          { entity: "HUNO", clientId: clientA.id, payeeId: payeeA.id, unitPrice: 10000, transportFee: 0, materialFee: 0, count: 1, memo: "" },
          { entity: "HUNO", clientId: clientA.id, payeeId: payeeB.id, unitPrice: 20000, transportFee: 0, materialFee: 0, count: 2, memo: "" },
        ],
      );
      expect(result.ok).toBe(true);
      expect((await listPaymentRequests(ADMIN)).rows).toHaveLength(2);
    });
  });

  describe("listPaymentRequestsForExport", () => {
    it("ids가 있으면 필터를 무시하고 해당 건만 반환한다", async () => {
      const { pmA, clientA } = await seed();
      const r1 = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
        data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "A건", status: "PREPARING" }),
      }));
      await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
        data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "B건", status: "COMPLETED" }),
      }));

      const rows = await listPaymentRequestsForExport(ADMIN, { status: "COMPLETED" }, [r1.id]);
      expect(rows.map((r) => r.bizName)).toEqual(["A건"]);
    });

    it("ids 없이 필터만 지정하면 페이지네이션 없이 필터링된 전체 결과를 반환한다", async () => {
      const { pmA, clientA } = await seed();
      for (let i = 0; i < PAYMENT_REQUEST_PAGE_SIZE + 1; i++) {
        await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
          data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: `건${i}` }),
        }));
      }
      const rows = await listPaymentRequestsForExport(ADMIN, { clientId: clientA.id });
      expect(rows).toHaveLength(PAYMENT_REQUEST_PAGE_SIZE + 1);
    });

    it("연동된 Payee의 지급 리스트 정보를 원문으로 포함한다", async () => {
      const { pmA, clientA } = await seed();
      const payee = await createPayee("1101234567", "김강사", "BUSINESS_INCOME");
      await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
        data: { ...baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "김강사" }), payeeId: payee.id },
      }));

      const [row] = await listPaymentRequestsForExport(ADMIN);
      expect(row.payeeKeyId).toBe(payee.keyId);
      expect(row.phone).toBe("010-1234-5678");
      expect(row.bizNumber).toBe("1101234567");
      expect(row.bankName).toBe("국민");
      expect(row.accountNumber).toBe("110123456789");
      expect(row.accountHolder).toBe("예금주");
    });

    it("payeeId가 없는 건은 지급 리스트 연동 컬럼이 빈 문자열이다", async () => {
      const { pmA, clientA } = await seed();
      await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
        data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "예외건" }),
      }));

      const [row] = await listPaymentRequestsForExport(ADMIN);
      expect(row.payeeKeyId).toBe("");
      expect(row.phone).toBe("");
      expect(row.bizNumber).toBe("");
      expect(row.bankName).toBe("");
      expect(row.accountNumber).toBe("");
      expect(row.accountHolder).toBe("");
    });

    it("사업자명·청구방식은 등록 시점 스냅샷을 그대로 사용한다(Payee 최신값 아님)", async () => {
      const { pmA, clientA } = await seed();
      const payee = await createPayee("1101234567", "김강사", "TAX_INVOICE");
      await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
        data: {
          ...baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "등록당시이름", taxType: "BUSINESS_INCOME" }),
          payeeId: payee.id,
        },
      }));
      await withRLS(ADMIN, (tx) => tx.payee.update({ where: { id: payee.id }, data: { bizName: "바뀐이름", taxType: "TAX_INVOICE" } }));

      const [row] = await listPaymentRequestsForExport(ADMIN);
      expect(row.bizName).toBe("등록당시이름");
      expect(row.taxType).toBe("BUSINESS_INCOME");
    });

    it("seqNo/지급일/지급여부를 포함한다", async () => {
      const { pmA, clientA } = await seed();
      const created = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
        data: baseInput({
          requesterId: pmA.id, clientId: clientA.id, bizName: "C건",
          payDate: new Date("2026-08-05"), status: "COMPLETED",
        }),
      }));

      const [row] = await listPaymentRequestsForExport(ADMIN);
      expect(row.seqNo).toBe(created.seqNo);
      expect(row.payDate).toEqual(new Date("2026-08-05"));
      expect(row.status).toBe("COMPLETED");
    });
  });

  describe("updatePaymentRequestsBulk", () => {
    it("seqNo로 매칭된 건의 지급일/지급여부만 갱신한다", async () => {
      const { pmA, clientA } = await seed();
      const created = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
        data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "A건", unitPrice: 50000 }),
      }));

      const result = await updatePaymentRequestsBulk(ADMIN, [
        { seqNo: created.seqNo, payDate: new Date("2026-08-05"), status: "COMPLETED" },
      ]);
      expect(result).toEqual({ updated: 1, notFoundSeqNos: [] });

      const { rows: [row] } = await listPaymentRequests(ADMIN);
      expect(row.payDate).toEqual(new Date("2026-08-05"));
      expect(row.status).toBe("COMPLETED");
      expect(row.unitPrice).toBe(50000); // 다른 필드는 그대로
    });

    it("존재하지 않는 seqNo는 notFoundSeqNos로 보고한다", async () => {
      const result = await updatePaymentRequestsBulk(ADMIN, [
        { seqNo: 999999, payDate: new Date("2026-08-05"), status: "COMPLETED" },
      ]);
      expect(result).toEqual({ updated: 0, notFoundSeqNos: [999999] });
    });

    it("소프트 삭제된 건은 매칭 대상에서 제외한다", async () => {
      const { pmA, clientA } = await seed();
      const created = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
        data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "삭제건" }),
      }));
      await withRLS(ADMIN, (tx) => tx.paymentRequest.update({ where: { id: created.id }, data: { deletedAt: new Date() } }));

      const result = await updatePaymentRequestsBulk(ADMIN, [
        { seqNo: created.seqNo, payDate: new Date("2026-08-05"), status: "COMPLETED" },
      ]);
      expect(result).toEqual({ updated: 0, notFoundSeqNos: [created.seqNo] });
    });

    it("지급일을 null로 업로드하면 기존 값을 지운다", async () => {
      const { pmA, clientA } = await seed();
      const created = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
        data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "B건", payDate: new Date("2026-08-01"), status: "COMPLETED" }),
      }));

      await updatePaymentRequestsBulk(ADMIN, [{ seqNo: created.seqNo, payDate: null, status: "PREPARING" }]);

      const { rows: [row] } = await listPaymentRequests(ADMIN);
      expect(row.payDate).toBeNull();
      expect(row.status).toBe("PREPARING");
    });

    it("여러 건을 한 번에 반영한다", async () => {
      const { pmA, clientA } = await seed();
      const a = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
        data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "A건" }),
      }));
      const b = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
        data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "B건", payDate: new Date("2026-08-01"), status: "COMPLETED" }),
      }));

      const result = await updatePaymentRequestsBulk(ADMIN, [
        { seqNo: a.seqNo, payDate: new Date("2026-08-05"), status: "COMPLETED" },
        { seqNo: b.seqNo, payDate: null, status: "PREPARING" },
      ]);
      expect(result).toEqual({ updated: 2, notFoundSeqNos: [] });

      // 각 행이 자신의 고유한 값을 받았는지 확인 (값 교환 버그 등을 감지)
      const { rows } = await listPaymentRequests(ADMIN);
      const rowA = rows.find((r) => r.bizName === "A건");
      const rowB = rows.find((r) => r.bizName === "B건");
      expect(rowA).toBeDefined();
      expect(rowB).toBeDefined();
      expect(rowA!.payDate).toEqual(new Date("2026-08-05"));
      expect(rowA!.status).toBe("COMPLETED");
      expect(rowB!.payDate).toBeNull();
      expect(rowB!.status).toBe("PREPARING");
    });

    it("DB와 값이 동일한 행은 재업데이트하지 않고 updated에도 세지 않는다(변경된 행만 카운트)", async () => {
      const { pmA, clientA } = await seed();
      const unchanged = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
        data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "미변경건", payDate: new Date("2026-08-05"), status: "COMPLETED" }),
      }));
      const changed = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
        data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "변경건", payDate: null, status: "PREPARING" }),
      }));

      const result = await updatePaymentRequestsBulk(ADMIN, [
        { seqNo: unchanged.seqNo, payDate: new Date("2026-08-05"), status: "COMPLETED" }, // 기존 값과 동일 → no-op
        { seqNo: changed.seqNo, payDate: new Date("2026-08-10"), status: "COMPLETED" }, // 실제로 변경됨
      ]);
      expect(result).toEqual({ updated: 1, notFoundSeqNos: [] });

      const { rows } = await listPaymentRequests(ADMIN);
      const rowUnchanged = rows.find((r) => r.bizName === "미변경건");
      const rowChanged = rows.find((r) => r.bizName === "변경건");
      expect(rowUnchanged!.payDate).toEqual(new Date("2026-08-05"));
      expect(rowUnchanged!.status).toBe("COMPLETED");
      expect(rowChanged!.payDate).toEqual(new Date("2026-08-10"));
      expect(rowChanged!.status).toBe("COMPLETED");
    });
  });
});
