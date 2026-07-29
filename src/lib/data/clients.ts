import { withRLS, type RlsContext } from "@/lib/rls";
import type { ActionState } from "@/lib/action-state";

export type ClientInput = {
  name: string;
  status?: string;
  businessType?: string | null;
  industry?: string | null;
  contractStart?: Date | null;
  contractEnd?: Date | null;
  billingCycle?: string[]; // 청구 주기(복수). 미선택이면 []로 클리어.
  reportCycle?: string[]; // 보고 주기(복수). 미선택이면 []로 클리어.
  pmIds?: string[]; // 담당 PM(여러 명). undefined면 담당 배정을 건드리지 않는다.
};

const withManagers = { include: { managers: true } } as const;

export function listClients(ctx: RlsContext) {
  // 보관(소프트 삭제)된 고객사는 모든 목록에서 제외한다.
  return withRLS(ctx, (tx) =>
    tx.client.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, ...withManagers }),
  );
}

export function getClient(ctx: RlsContext, id: string) {
  return withRLS(ctx, (tx) => tx.client.findUnique({ where: { id }, ...withManagers }));
}

// 보관(소프트 삭제)된 고객사 목록. 복원 화면에서만 사용한다.
export function listArchivedClients(ctx: RlsContext) {
  return withRLS(ctx, (tx) =>
    tx.client.findMany({ where: { deletedAt: { not: null } }, orderBy: { name: "asc" }, ...withManagers }),
  );
}

export function createClient(ctx: RlsContext, input: ClientInput) {
  return withRLS(ctx, (tx) =>
    tx.client.create({
      data: {
        name: input.name,
        status: input.status ?? "진행중",
        businessType: input.businessType ?? null,
        industry: input.industry ?? null,
        contractStart: input.contractStart ?? null,
        contractEnd: input.contractEnd ?? null,
        billingCycle: input.billingCycle ?? [],
        reportCycle: input.reportCycle ?? [],
        managers: input.pmIds?.length
          ? { create: input.pmIds.map((userId) => ({ userId })) }
          : undefined,
      },
      ...withManagers,
    }),
  );
}

export async function updateClient(ctx: RlsContext, id: string, input: ClientInput): Promise<ActionState> {
  const result = await withRLS(ctx, async (tx) => {
    const updated = await tx.client.updateMany({
      where: { id },
      // patch 의미: undefined 필드는 건드리지 않고(스킵), null은 명시적 클리어.
      // zod clientSchema가 빈칸→null(클리어), 미포함→undefined(스킵)로 매핑하는 것과 정합.
      data: {
        name: input.name,
        status: input.status,
        businessType: input.businessType,
        industry: input.industry,
        contractStart: input.contractStart,
        contractEnd: input.contractEnd,
        billingCycle: input.billingCycle,
        reportCycle: input.reportCycle,
      },
    });
    // 접근 불가(RLS로 count 0)면 담당 배정도 손대지 않는다.
    if (updated.count === 0) return { count: 0 };
    // pmIds가 주어지면 담당 PM 전체를 교체(미포함이면 유지).
    if (input.pmIds !== undefined) {
      await tx.clientManager.deleteMany({ where: { clientId: id } });
      if (input.pmIds.length) {
        await tx.clientManager.createMany({ data: input.pmIds.map((userId) => ({ clientId: id, userId })) });
      }
    }
    return { count: updated.count };
  });
  if (result.count === 0) return { ok: false, error: "고객사를 찾을 수 없거나 권한이 없습니다." };
  return { ok: true };
}

// 담당 PM 배정만 교체한다(고객사 다른 필드는 손대지 않는다).
export async function updateClientPms(ctx: RlsContext, id: string, pmIds: string[]): Promise<ActionState> {
  const ok = await withRLS(ctx, async (tx) => {
    // RLS로 접근 불가면 배정도 손대지 않는다.
    const existing = await tx.client.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return false;
    await tx.clientManager.deleteMany({ where: { clientId: id } });
    if (pmIds.length) {
      await tx.clientManager.createMany({ data: pmIds.map((userId) => ({ clientId: id, userId })) });
    }
    return true;
  });
  if (!ok) return { ok: false, error: "고객사를 찾을 수 없거나 권한이 없습니다." };
  return { ok: true };
}

// 현대이지웰 여부 토글. 목록 인라인 체크박스가 즉시 저장한다.
// RLS로 접근 불가면 count 0 → ok:false (PM은 본인 담당 고객사만 반영).
export async function setClientEasywel(ctx: RlsContext, id: string, on: boolean): Promise<ActionState> {
  const result = await withRLS(ctx, (tx) =>
    tx.client.updateMany({ where: { id }, data: { hyundaiEasywel: on } }),
  );
  if (result.count === 0) return { ok: false, error: "고객사를 찾을 수 없거나 권한이 없습니다." };
  return { ok: true };
}

// 소프트 삭제(보관): deletedAt만 찍는다. 연관 데이터는 보존하고 목록에서만 숨긴다.
// 이미 보관됐거나(RLS로) 접근 불가면 count 0 → ok:false.
export async function archiveClient(ctx: RlsContext, id: string): Promise<ActionState> {
  const result = await withRLS(ctx, (tx) =>
    tx.client.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } }),
  );
  if (result.count === 0) return { ok: false, error: "고객사를 찾을 수 없거나 권한이 없습니다." };
  return { ok: true };
}

// 보관 취소(복원): deletedAt을 지운다. 보관 상태가 아니거나 접근 불가면 count 0 → ok:false.
export async function restoreClient(ctx: RlsContext, id: string): Promise<ActionState> {
  const result = await withRLS(ctx, (tx) =>
    tx.client.updateMany({ where: { id, deletedAt: { not: null } }, data: { deletedAt: null } }),
  );
  if (result.count === 0) return { ok: false, error: "고객사를 찾을 수 없거나 권한이 없습니다." };
  return { ok: true };
}
