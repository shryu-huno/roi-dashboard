import { withRLS, type RlsContext } from "@/lib/rls";
import type { ActionState } from "@/lib/action-state";

export type ClientInput = {
  name: string;
  status?: string;
  businessType?: string | null;
  industry?: string | null;
};

const withManagers = { include: { managers: true } } as const;
// 목록 카드는 프로젝트별 청구·보고 주기/실적계약을 고객사 단위로 합산해 표시한다.
const withManagersAndProjects = {
  include: {
    managers: true,
    projects: {
      where: { deletedAt: null },
      select: { billingCycle: true, reportCycle: true, performanceContract: true },
    },
  },
} as const;

export function listClients(ctx: RlsContext) {
  // 보관(소프트 삭제)된 고객사는 모든 목록에서 제외한다.
  return withRLS(ctx, (tx) =>
    tx.client.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, ...withManagersAndProjects }),
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
  // 담당 PM·주기·계약기간은 고객사 생성 후 프로젝트를 추가하며 지정한다.
  return withRLS(ctx, (tx) =>
    tx.client.create({
      data: {
        name: input.name,
        status: input.status ?? "진행중",
        businessType: input.businessType ?? null,
        industry: input.industry ?? null,
      },
      ...withManagers,
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
        businessType: input.businessType,
        industry: input.industry,
      },
    }),
  );
  if (result.count === 0) return { ok: false, error: "고객사를 찾을 수 없거나 권한이 없습니다." };
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

// 하드 삭제: 고객사와 연관 데이터(과업·지출·상담비 등, 스키마상 onDelete: Cascade)를 완전히 제거한다.
// 되돌릴 수 없으므로 이미 숨김(soft delete) 처리된 고객사에 한해 허용한다.
export async function hardDeleteClient(ctx: RlsContext, id: string): Promise<ActionState> {
  const result = await withRLS(ctx, (tx) =>
    tx.client.deleteMany({ where: { id, deletedAt: { not: null } } }),
  );
  if (result.count === 0) return { ok: false, error: "고객사를 찾을 수 없거나 권한이 없습니다." };
  return { ok: true };
}
