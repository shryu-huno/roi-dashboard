import { withRLS, type RlsContext } from "@/lib/rls";
import type { ActionState } from "@/lib/action-state";

export type ClientInput = {
  name: string;
  status?: string;
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
      data: {
        name: input.name,
        status: input.status,
        contractStart: input.contractStart ?? null,
        contractEnd: input.contractEnd ?? null,
        pmId: input.pmId ?? null,
      },
    }),
  );
  if (result.count === 0) return { ok: false, error: "고객사를 찾을 수 없거나 권한이 없습니다." };
  return { ok: true };
}
