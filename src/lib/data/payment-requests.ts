import type { PaymentRequestEntity, PaymentRequestStatus, Prisma, TaxType } from "@prisma/client";
import { withRLS, type RlsContext } from "@/lib/rls";

export const PAYMENT_REQUEST_PAGE_SIZE = 50;

const PAYMENT_REQUEST_ENTITIES: readonly PaymentRequestEntity[] = ["HUNO", "HUNO_INC"];
const PAYMENT_REQUEST_STATUSES: readonly PaymentRequestStatus[] = ["PREPARING", "COMPLETED"];

// URL 쿼리 파라미터(page)를 파싱. 1 미만이거나 정수가 아니면 1(첫 페이지)로 클램프.
export function parsePaymentRequestPage(value: string | undefined): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return 1;
  return n;
}

// 알 수 없는 값(URL 조작 등)은 undefined 반환 — 호출부가 필터를 무시하도록.
export function parsePaymentRequestEntity(value: string | undefined): PaymentRequestEntity | undefined {
  return PAYMENT_REQUEST_ENTITIES.find((e) => e === value);
}

export function parsePaymentRequestStatus(value: string | undefined): PaymentRequestStatus | undefined {
  return PAYMENT_REQUEST_STATUSES.find((s) => s === value);
}

// <input type="date">의 "YYYY-MM-DD" 형식만 허용. 그 외(빈 값, 잘못된 형식)는 undefined.
export function parsePaymentRequestDateParam(value: string | undefined): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export type PaymentRequestFilter = {
  payDateFrom?: Date;
  payDateTo?: Date;
  clientId?: string;
  entity?: PaymentRequestEntity;
  status?: PaymentRequestStatus;
  bizName?: string;
};

// 목록 화면(11개 고정 컬럼)과 상세보기 모달이 함께 쓰는 행 타입. 상세 전용 필드(단가/교통비/
// 재료비/횟수/청구방식/상세내역)도 함께 내려보내 상세보기가 별도 조회 없이 이 행을 그대로 쓴다.
export type PaymentRequestRow = {
  id: string;
  requestedAt: Date;
  requesterId: string;
  requesterName: string;
  entity: PaymentRequestEntity;
  clientId: string;
  clientName: string;
  bizName: string;
  unitPrice: number;
  transportFee: number;
  materialFee: number;
  count: number;
  amount: number;
  taxType: TaxType;
  memo: string;
  payDate: Date | null;
  status: PaymentRequestStatus;
};

export type PaymentRequestPage<T> = { rows: T[]; page: number; totalPages: number };

function buildWhere(filter?: PaymentRequestFilter): Prisma.PaymentRequestWhereInput {
  const where: Prisma.PaymentRequestWhereInput = { deletedAt: null };
  if (!filter) return where;
  if (filter.clientId) where.clientId = filter.clientId;
  if (filter.entity) where.entity = filter.entity;
  if (filter.status) where.status = filter.status;
  if (filter.bizName?.trim()) where.bizName = { contains: filter.bizName.trim(), mode: "insensitive" };
  if (filter.payDateFrom || filter.payDateTo) {
    where.payDate = {
      ...(filter.payDateFrom ? { gte: filter.payDateFrom } : {}),
      ...(filter.payDateTo ? { lte: filter.payDateTo } : {}),
    };
  }
  return where;
}

// RLS(ClientManager 경유)가 PM 범위를 자동 제한하므로 role별 함수 분기가 필요 없다
// (Payee와 달리 필드 마스킹도 없다 — 화면 차이는 엑셀 다운로드 버튼 노출 여부뿐).
export async function listPaymentRequests(
  ctx: RlsContext,
  filter?: PaymentRequestFilter,
  page = 1,
): Promise<PaymentRequestPage<PaymentRequestRow>> {
  const where = buildWhere(filter);
  const skip = (page - 1) * PAYMENT_REQUEST_PAGE_SIZE;

  const fetchPage = (p: number) => withRLS(ctx, async (tx) => {
    const [rows, totalCount] = await Promise.all([
      tx.paymentRequest.findMany({
        where,
        orderBy: { requestedAt: "desc" },
        include: { requester: { select: { name: true, email: true } }, client: { select: { name: true } } },
        skip: (p - 1) * PAYMENT_REQUEST_PAGE_SIZE,
        take: PAYMENT_REQUEST_PAGE_SIZE,
      }),
      tx.paymentRequest.count({ where }),
    ]);
    return { rows, totalCount };
  });

  let { rows, totalCount } = await fetchPage(page);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAYMENT_REQUEST_PAGE_SIZE));
  // 삭제 등으로 결과가 줄어 요청한 page가 범위를 벗어나면 마지막 페이지로 클램프해 재조회한다.
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  if (clampedPage !== page) {
    ({ rows, totalCount } = await fetchPage(clampedPage));
  }

  const mapped = rows.map((r) => ({
    id: r.id,
    requestedAt: r.requestedAt,
    requesterId: r.requesterId,
    requesterName: r.requester.name ?? r.requester.email,
    entity: r.entity,
    clientId: r.clientId,
    clientName: r.client.name,
    bizName: r.bizName,
    unitPrice: r.unitPrice,
    transportFee: r.transportFee,
    materialFee: r.materialFee,
    count: r.count,
    amount: r.amount,
    taxType: r.taxType,
    memo: r.memo,
    payDate: r.payDate,
    status: r.status,
  }));
  return { rows: mapped, page: clampedPage, totalPages };
}
