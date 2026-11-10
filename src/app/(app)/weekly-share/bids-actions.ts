"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { bidSchema } from "@/lib/validation/schemas";
import { createBid, updateBid } from "@/lib/data/bids";
import { canEditBids } from "./tabs";

export type SaveBidResult = { ok: true } | { ok: false; error: string };

// 입찰 등록(id 없음)·수정(id 있음). 최고관리자·팀 관리자만(파트장은 보기만) — DB(RLS)도 같은 규칙으로 막는다.
// 검증에 걸리면 첫 번째 문제를 사람이 읽을 문장으로 돌려준다.
export async function saveBidAction(payload: unknown, id: string | null): Promise<SaveBidResult> {
  const user = await requireUser();
  if (!canEditBids(user.role)) return { ok: false, error: "입찰 등록·수정은 관리자만 할 수 있습니다." };

  const parsed = bidSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값이 올바르지 않습니다." };

  const ctx = getRlsContext(user);
  const result = id ? await updateBid(ctx, id, parsed.data) : await createBid(ctx, parsed.data);
  if (!result.ok) return { ok: false, error: result.error ?? "저장하지 못했습니다." };
  revalidatePath("/weekly-share");
  return { ok: true };
}
