import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS } from "@/lib/rls";
import { getPaymentRequestNotice, upsertPaymentRequestNotice } from "@/lib/data/payment-request-notice";

const ADMIN = { userId: "seed-admin", role: "ADMIN" as const };
const SETTLEMENT = { userId: "seed-settlement", role: "SETTLEMENT" as const };
const PM = { userId: "seed-pm", role: "PM" as const };

async function reset() {
  await withRLS(ADMIN, (tx) => tx.paymentRequestNotice.deleteMany());
}

describe("payment-request-notice 데이터 계층", () => {
  beforeEach(reset);

  it("공지가 없으면 빈 문자열을 반환한다", async () => {
    const content = await getPaymentRequestNotice(ADMIN);
    expect(content).toBe("");
  });

  it("SETTLEMENT가 저장하면 반영되고, 다시 조회하면 그대로 나온다", async () => {
    const result = await upsertPaymentRequestNotice(SETTLEMENT, "정산 마감 안내드립니다.");
    expect(result.ok).toBe(true);
    const content = await getPaymentRequestNotice(ADMIN);
    expect(content).toBe("정산 마감 안내드립니다.");
  });

  it("같은 내용을 다시 저장하면 기존 공지를 덮어쓴다(행은 여전히 1개)", async () => {
    await upsertPaymentRequestNotice(ADMIN, "1차 공지");
    await upsertPaymentRequestNotice(ADMIN, "2차 공지");
    const content = await getPaymentRequestNotice(ADMIN);
    expect(content).toBe("2차 공지");
    const rows = await withRLS(ADMIN, (tx) => tx.paymentRequestNotice.findMany());
    expect(rows.length).toBe(1);
  });

  it("빈 문자열로 저장하면 공지가 비워진다", async () => {
    await upsertPaymentRequestNotice(ADMIN, "지울 공지");
    await upsertPaymentRequestNotice(ADMIN, "");
    const content = await getPaymentRequestNotice(ADMIN);
    expect(content).toBe("");
  });

  it("PM은 조회할 수 있다", async () => {
    await upsertPaymentRequestNotice(ADMIN, "PM도 볼 수 있는 공지");
    const content = await getPaymentRequestNotice(PM);
    expect(content).toBe("PM도 볼 수 있는 공지");
  });

  it("PM은 저장할 수 없다(RLS 거부)", async () => {
    await expect(upsertPaymentRequestNotice(PM, "PM이 쓰려는 공지")).rejects.toThrow();
  });
});
