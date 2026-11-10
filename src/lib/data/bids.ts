import { withRLS, type RlsContext } from "@/lib/rls";
import type { ActionState } from "@/lib/action-state";
import type { BidKind, BidStatus, BidView } from "@/lib/bids";

export type BidInput = {
  orgName: string;
  title: string;
  kind: BidKind;
  amount: number;
  dueDate: string; // 제출 마감일 "YYYY-MM-DD"
  announceDate: string; // 결과 발표일
  status: BidStatus;
  note: string;
};

const toDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const ymdOf = (d: Date) => d.toISOString().slice(0, 10);

const data = (i: BidInput) => ({
  orgName: i.orgName,
  title: i.title,
  kind: i.kind,
  amount: BigInt(i.amount), // DB는 64비트 정수. 입력은 schemas에서 안전한 정수 범위로 제한된다
  dueDate: toDate(i.dueDate),
  announceDate: toDate(i.announceDate),
  status: i.status,
  note: i.note,
});

/** 전체 입찰(정렬·필터는 lib/bids.ts). 최고관리자·팀 관리자 외에는 RLS로 빈 목록이다. */
export function listBids(ctx: RlsContext): Promise<BidView[]> {
  return withRLS(ctx, async (tx) => {
    const rows = await tx.bid.findMany({ orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }] });
    return rows.map((r) => ({
      id: r.id,
      orgName: r.orgName,
      title: r.title,
      kind: r.kind,
      amount: Number(r.amount), // 화면·집계는 숫자로 다룬다(안전한 정수 범위 안)
      dueDate: ymdOf(r.dueDate),
      announceDate: ymdOf(r.announceDate),
      status: r.status,
      note: r.note,
    }));
  });
}

/** 등록. 권한이 없으면 DB(RLS)가 거부해 오류가 난다. */
export async function createBid(ctx: RlsContext, input: BidInput): Promise<ActionState> {
  await withRLS(ctx, (tx) => tx.bid.create({ data: data(input) }));
  return { ok: true };
}

/** 수정. 대상이 없거나 권한상 보이지 않으면 "찾을 수 없음". */
export async function updateBid(ctx: RlsContext, id: string, input: BidInput): Promise<ActionState> {
  const { count } = await withRLS(ctx, (tx) => tx.bid.updateMany({ where: { id }, data: data(input) }));
  return count === 0 ? { ok: false, error: "입찰을 찾을 수 없습니다." } : { ok: true };
}
