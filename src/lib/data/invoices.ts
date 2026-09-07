import { withRLS, type RlsContext } from "@/lib/rls";
import { prisma } from "@/lib/db";
import type { ActionState } from "@/lib/action-state";

export type InvoiceInput = {
  clientId: string;
  amount: number; // VAT 포함(gross)
  issueDate: Date;
  note?: string | null;
};

// 청구 리스트 한 행. 입력값 + 고객사에서 파생한 사업자 구분·담당 PM.
export type InvoiceRow = {
  id: string;
  clientId: string;
  clientName: string;
  businessType: string | null;
  pmLabel: string; // 담당 PM(쉼표 결합), 없으면 "미배정"
  amount: number;
  issueDate: Date;
  note: string | null;
  paidDate: Date | null;
};

// 접근 가능한 전체 청구를 최신순(등록순)으로. 담당 PM 이름은 getClientSummaries와 동일하게
// 전역 prisma.user로 해결한다(User는 roi_app 전면 허용 정책이라 조회 가능).
export async function listInvoices(ctx: RlsContext): Promise<InvoiceRow[]> {
  const invoices = await withRLS(ctx, (tx) =>
    tx.invoice.findMany({
      orderBy: { createdAt: "desc" },
      include: { client: { select: { name: true, businessType: true, managers: { select: { userId: true } } } } },
    }),
  );

  const pmIds = [...new Set(invoices.flatMap((iv) => iv.client.managers.map((m) => m.userId)))];
  const users = pmIds.length ? await prisma.user.findMany({ where: { id: { in: pmIds } } }) : [];
  const labelById = new Map(users.map((u) => [u.id, u.name ?? u.email]));

  return invoices.map((iv) => {
    const labels = iv.client.managers
      .map((m) => labelById.get(m.userId) ?? "(알 수 없음)")
      .sort((a, b) => a.localeCompare(b, "ko"));
    return {
      id: iv.id,
      clientId: iv.clientId,
      clientName: iv.client.name,
      businessType: iv.client.businessType,
      pmLabel: labels.length ? labels.join(", ") : "미배정",
      amount: iv.amount,
      issueDate: iv.issueDate,
      note: iv.note,
      paidDate: iv.paidDate,
    };
  });
}

export async function createInvoice(ctx: RlsContext, input: InvoiceInput): Promise<ActionState> {
  // 배정되지 않은 고객사면 WITH CHECK(app_can_see_client) 위반으로 INSERT가 막힌다.
  try {
    await withRLS(ctx, (tx) =>
      tx.invoice.create({
        data: { clientId: input.clientId, amount: input.amount, issueDate: input.issueDate, note: input.note ?? null },
      }),
    );
  } catch {
    return { ok: false, error: "청구를 저장할 수 없거나 권한이 없습니다." };
  }
  return { ok: true };
}

export async function updateInvoice(ctx: RlsContext, id: string, input: InvoiceInput): Promise<ActionState> {
  const result = await withRLS(ctx, (tx) =>
    tx.invoice.updateMany({
      where: { id },
      data: { clientId: input.clientId, amount: input.amount, issueDate: input.issueDate, note: input.note ?? null },
    }),
  );
  if (result.count === 0) return { ok: false, error: "청구를 찾을 수 없거나 권한이 없습니다." };
  return { ok: true };
}

export async function deleteInvoice(ctx: RlsContext, id: string): Promise<ActionState> {
  const result = await withRLS(ctx, (tx) => tx.invoice.deleteMany({ where: { id } }));
  if (result.count === 0) return { ok: false, error: "청구를 찾을 수 없거나 권한이 없습니다." };
  return { ok: true };
}

// 입금 확인: 입금일자를 기록한다. RLS로 접근 불가면 count 0 → ok:false.
export async function markInvoicePaid(ctx: RlsContext, id: string, paidDate: Date): Promise<ActionState> {
  const result = await withRLS(ctx, (tx) => tx.invoice.updateMany({ where: { id }, data: { paidDate } }));
  if (result.count === 0) return { ok: false, error: "청구를 찾을 수 없거나 권한이 없습니다." };
  return { ok: true };
}
