import { withRLS, type RlsContext } from "@/lib/rls";
import type { ActionState } from "@/lib/action-state";

export type ClientInput = {
  name: string;
  status?: string;
  industry?: string | null;
  contractStart?: Date | null;
  contractEnd?: Date | null;
  pmId?: string | null;
};

export function listClients(ctx: RlsContext) {
  return withRLS(ctx, (tx) => tx.client.findMany({ orderBy: { name: "asc" } }));
}

export function getClient(ctx: RlsContext, id: string) {
  return withRLS(ctx, (tx) => tx.client.findUnique({ where: { id } }));
}

export function createClient(ctx: RlsContext, input: ClientInput) {
  return withRLS(ctx, (tx) =>
    tx.client.create({
      data: {
        name: input.name,
        status: input.status ?? "진행중",
        industry: input.industry ?? null,
        contractStart: input.contractStart ?? null,
        contractEnd: input.contractEnd ?? null,
        pmId: input.pmId ?? null,
      },
    }),
  );
}

export async function updateClient(ctx: RlsContext, id: string, input: ClientInput): Promise<ActionState> {
  const result = await withRLS(ctx, (tx) =>
    tx.client.updateMany({
      where: { id },
      // patch 의미: undefined 필드는 건드리지 않고(스킵), null은 명시적 클리어.
      // zod clientSchema가 빈칸→null(클리어), 미포함→undefined(스킵)로 매핑하는 것과 정합.
      data: {
        name: input.name,
        status: input.status,
        industry: input.industry,
        contractStart: input.contractStart,
        contractEnd: input.contractEnd,
        pmId: input.pmId,
      },
    }),
  );
  if (result.count === 0) return { ok: false, error: "고객사를 찾을 수 없거나 권한이 없습니다." };
  return { ok: true };
}
