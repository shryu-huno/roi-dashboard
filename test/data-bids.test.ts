import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS, type RlsContext } from "@/lib/rls";
import { createBid, listBids, updateBid, type BidInput } from "@/lib/data/bids";

const ROOT: RlsContext = { userId: "seed-admin", role: "SUPER_ADMIN" };
const ctx = (role: RlsContext["role"]): RlsContext => ({ userId: `u-${role}`, role });

const input = (over: Partial<BidInput> = {}): BidInput => ({
  orgName: "세움도시공사", title: "2027년 EAP 운영 용역", kind: "NEW", amount: 186_000_000,
  dueDate: "2026-11-12", announceDate: "2026-11-26", status: "PREPARING", note: "", ...over,
});

beforeEach(async () => {
  // 입찰 테이블은 DELETE 정책이 없어(삭제 불가) 일반 delete로는 비워지지 않는다 → 테스트 초기화만 TRUNCATE.
  await withRLS(ROOT, (tx) => tx.$executeRawUnsafe('TRUNCATE TABLE "Bid"'));
});

describe("입찰 등록·수정·조회", () => {
  it("등록하면 목록에 날짜 문자열과 함께 나온다", async () => {
    const res = await createBid(ctx("SUPER_ADMIN"), input());
    expect(res.ok).toBe(true);
    const list = await listBids(ctx("SUPER_ADMIN"));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      orgName: "세움도시공사", title: "2027년 EAP 운영 용역", kind: "NEW", amount: 186_000_000,
      dueDate: "2026-11-12", announceDate: "2026-11-26", status: "PREPARING", note: "",
    });
  });

  it("수정하면 같은 건이 바뀐다(새 건이 생기지 않는다)", async () => {
    await createBid(ctx("SUPER_ADMIN"), input());
    const [b] = await listBids(ctx("SUPER_ADMIN"));
    const res = await updateBid(ctx("SUPER_ADMIN"), b.id, input({ status: "WON", note: "2027.1 계약 예정", amount: 190_000_000 }));
    expect(res.ok).toBe(true);
    const list = await listBids(ctx("SUPER_ADMIN"));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: b.id, status: "WON", note: "2027.1 계약 예정", amount: 190_000_000 });
  });

  it("없는 건을 수정하면 오류를 돌려준다", async () => {
    const res = await updateBid(ctx("SUPER_ADMIN"), "nope", input());
    expect(res.ok).toBe(false);
  });
});

describe("권한(RLS): 읽기는 최고관리자·팀 관리자·파트장, 쓰기는 최고관리자·팀 관리자만", () => {
  it("팀 관리자도 등록·수정·조회할 수 있다", async () => {
    expect((await createBid(ctx("ADMIN"), input())).ok).toBe(true);
    const [b] = await listBids(ctx("ADMIN"));
    expect((await updateBid(ctx("ADMIN"), b.id, input({ status: "REVIEWING" }))).ok).toBe(true);
  });

  it("파트장은 입찰을 볼 수 있지만 등록·수정은 DB가 막는다(읽기 전용)", async () => {
    await createBid(ctx("SUPER_ADMIN"), input());
    const seen = await listBids(ctx("PART_LEADER"));
    expect(seen).toHaveLength(1);
    expect(seen[0].orgName).toBe("세움도시공사");
    await expect(createBid(ctx("PART_LEADER"), input({ orgName: "몰래 등록" }))).rejects.toThrow();
    expect((await updateBid(ctx("PART_LEADER"), seen[0].id, input({ status: "LOST" }))).ok).toBe(false);
    expect((await listBids(ctx("SUPER_ADMIN")))[0].status).toBe("PREPARING");
  });

  it("PM·정산담당은 조회 결과가 비고, 등록은 DB가 막는다", async () => {
    await createBid(ctx("SUPER_ADMIN"), input());
    for (const role of ["PM", "SETTLEMENT"] as const) {
      expect(await listBids(ctx(role))).toEqual([]);
      await expect(createBid(ctx(role), input({ orgName: "몰래 등록" }))).rejects.toThrow();
    }
    expect(await listBids(ctx("SUPER_ADMIN"))).toHaveLength(1);
  });

  it("PM은 기존 입찰을 수정할 수 없다(대상이 보이지 않아 '찾을 수 없음')", async () => {
    await createBid(ctx("SUPER_ADMIN"), input());
    const [b] = await listBids(ctx("SUPER_ADMIN"));
    expect((await updateBid(ctx("PM"), b.id, input({ status: "LOST" }))).ok).toBe(false);
    expect((await listBids(ctx("SUPER_ADMIN")))[0].status).toBe("PREPARING");
  });

  it("관리자라도 삭제는 할 수 없다(삭제 정책이 없다)", async () => {
    await createBid(ctx("SUPER_ADMIN"), input());
    const { count } = await withRLS(ctx("SUPER_ADMIN"), (tx) => tx.bid.deleteMany());
    expect(count).toBe(0);
    expect(await listBids(ctx("SUPER_ADMIN"))).toHaveLength(1);
  });
});
