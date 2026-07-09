import { withRLS, type RlsContext } from "@/lib/rls";
import type { ActionState } from "@/lib/action-state";

export type AmountInput = { clientId: string; year: number; month: number; amount: number | null };

export function getBilling(ctx: RlsContext, clientId: string, year: number, month: number) {
  return withRLS(ctx, (tx) =>
    tx.monthlyBilling.findUnique({ where: { clientId_year_month: { clientId, year, month } } }),
  );
}

export async function upsertBilling(ctx: RlsContext, input: AmountInput): Promise<ActionState> {
  await withRLS(ctx, async (tx) => {
    if (input.amount === null) {
      await tx.monthlyBilling.deleteMany({ where: { clientId: input.clientId, year: input.year, month: input.month } });
      return;
    }
    await tx.monthlyBilling.upsert({
      where: { clientId_year_month: { clientId: input.clientId, year: input.year, month: input.month } },
      create: { clientId: input.clientId, year: input.year, month: input.month, amount: input.amount },
      update: { amount: input.amount },
    });
  });
  return { ok: true };
}

export function getDeposit(ctx: RlsContext, clientId: string, year: number, month: number) {
  return withRLS(ctx, (tx) =>
    tx.monthlyDeposit.findUnique({ where: { clientId_year_month: { clientId, year, month } } }),
  );
}

export async function upsertDeposit(ctx: RlsContext, input: AmountInput): Promise<ActionState> {
  await withRLS(ctx, async (tx) => {
    if (input.amount === null) {
      await tx.monthlyDeposit.deleteMany({ where: { clientId: input.clientId, year: input.year, month: input.month } });
      return;
    }
    await tx.monthlyDeposit.upsert({
      where: { clientId_year_month: { clientId: input.clientId, year: input.year, month: input.month } },
      create: { clientId: input.clientId, year: input.year, month: input.month, amount: input.amount },
      update: { amount: input.amount },
    });
  });
  return { ok: true };
}
