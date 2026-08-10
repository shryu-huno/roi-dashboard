import { withRLS, type RlsContext } from "@/lib/rls";
import type { ActionState } from "@/lib/action-state";

const NOTICE_ID = "singleton";

export async function getPaymentRequestNotice(ctx: RlsContext): Promise<string> {
  return withRLS(ctx, async (tx) => {
    const row = await tx.paymentRequestNotice.findUnique({ where: { id: NOTICE_ID } });
    return row?.content ?? "";
  });
}

export async function upsertPaymentRequestNotice(ctx: RlsContext, content: string): Promise<ActionState> {
  return withRLS(ctx, async (tx) => {
    await tx.paymentRequestNotice.upsert({
      where: { id: NOTICE_ID },
      update: { content },
      create: { id: NOTICE_ID, content },
    });
    return { ok: true };
  });
}
