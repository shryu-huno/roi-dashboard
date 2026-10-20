import { withRLS, type RlsContext } from "@/lib/rls";
import type { ActionState } from "@/lib/action-state";

// 작성자 표시용 최소 필드만 조인한다(RLS상 User는 roi_app에 전면 허용).
const withAuthor = { include: { author: { select: { name: true, email: true } } } } as const;

// 한 고객사의 메모 이력(최신순). RLS로 접근 가능한 고객사만 반환된다(접근 불가면 빈 배열).
export function listClientMemos(ctx: RlsContext, clientId: string) {
  return withRLS(ctx, (tx) =>
    tx.clientMemo.findMany({ where: { clientId }, orderBy: { createdAt: "desc" }, ...withAuthor }),
  );
}

// 메모 추가. 작성자는 세션 사용자(authorId). RLS WITH CHECK(app_can_see_client)가 범위를 강제한다.
export function createClientMemo(ctx: RlsContext, input: { clientId: string; content: string; authorId: string }) {
  return withRLS(ctx, (tx) =>
    tx.clientMemo.create({ data: { clientId: input.clientId, content: input.content, authorId: input.authorId } }),
  );
}

// 메모 수정 — 내용만. 접근 불가면(RLS) count 0 → ok:false.
export async function updateClientMemo(ctx: RlsContext, id: string, content: string): Promise<ActionState> {
  const result = await withRLS(ctx, (tx) => tx.clientMemo.updateMany({ where: { id }, data: { content } }));
  if (result.count === 0) return { ok: false, error: "메모를 찾을 수 없거나 권한이 없습니다." };
  return { ok: true };
}

// 메모 삭제. 접근 불가면(RLS) count 0 → ok:false.
export async function deleteClientMemo(ctx: RlsContext, id: string): Promise<ActionState> {
  const result = await withRLS(ctx, (tx) => tx.clientMemo.deleteMany({ where: { id } }));
  if (result.count === 0) return { ok: false, error: "메모를 찾을 수 없거나 권한이 없습니다." };
  return { ok: true };
}

// 목록·대시보드 표시용: 접근 가능한 고객사들의 메모 건수와 최신 메모 내용을 고객사별로 요약한다.
// 최신순으로 받아 고객사별 첫 등장이 최신 메모가 된다.
export async function getClientMemoSummaries(
  ctx: RlsContext,
): Promise<Map<string, { count: number; latest: string }>> {
  const rows = await withRLS(ctx, (tx) =>
    tx.clientMemo.findMany({ orderBy: { createdAt: "desc" }, select: { clientId: true, content: true } }),
  );
  const map = new Map<string, { count: number; latest: string }>();
  for (const r of rows) {
    const cur = map.get(r.clientId);
    if (cur) cur.count += 1;
    else map.set(r.clientId, { count: 1, latest: r.content });
  }
  return map;
}
