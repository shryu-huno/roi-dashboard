import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS } from "@/lib/rls";
import {
  listPaymentRequests, parsePaymentRequestPage, parsePaymentRequestEntity,
  parsePaymentRequestStatus, parsePaymentRequestDateParam, PAYMENT_REQUEST_PAGE_SIZE,
} from "@/lib/data/payment-requests";

const ADMIN = { userId: "seed-admin", role: "ADMIN" as const };

async function reset() {
  await withRLS(ADMIN, async (tx) => {
    await tx.paymentRequest.deleteMany();
    await tx.client.deleteMany();
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
});
