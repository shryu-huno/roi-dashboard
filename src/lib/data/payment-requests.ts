import type { PaymentRequestEntity, PaymentRequestStatus, Prisma, TaxType } from "@prisma/client";
import { withRLS, type RlsContext } from "@/lib/rls";
import type { ActionState } from "@/lib/action-state";
import type { PaymentRequestCreateInput } from "@/lib/payment-request-validation";
import { decrypt } from "@/lib/crypto/payee-secret";

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
  seqNo: number;
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

  const fetchPage = (p: number) => withRLS(ctx, async (tx) => {
    const [rows, totalCount] = await Promise.all([
      tx.paymentRequest.findMany({
        where,
        orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
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
    seqNo: r.seqNo,
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

export type PaymentRequestExportRow = {
  seqNo: number;
  requesterName: string;
  entity: PaymentRequestEntity;
  clientName: string;
  bizName: string;
  payeeKeyId: string;
  phone: string;
  bizNumber: string;
  bankName: string;
  accountNumber: string;
  accountHolder: string;
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

// 엑셀 다운로드 전용. ids가 있으면 필터 없이 해당 건만(체크박스 선택), 없으면 필터링된 전체
// 결과를 페이지네이션 없이 반환한다. 사업자명/청구방식은 PaymentRequest 스냅샷을 그대로 쓰고,
// 나머지 지급 리스트 정보(고유번호/연락처/사업자번호/은행명/계좌번호/예금주)만 연동된 Payee에서
// 조회한다 — payeeId가 없는 건은 빈 문자열로 채운다. role 체크는 호출부(export 라우트)가 담당한다.
export async function listPaymentRequestsForExport(
  ctx: RlsContext,
  filter?: PaymentRequestFilter,
  ids?: string[],
): Promise<PaymentRequestExportRow[]> {
  const where: Prisma.PaymentRequestWhereInput = ids && ids.length > 0
    ? { id: { in: ids }, deletedAt: null }
    : buildWhere(filter);

  const rows = await withRLS(ctx, (tx) => tx.paymentRequest.findMany({
    where,
    orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
    include: {
      requester: { select: { name: true, email: true } },
      client: { select: { name: true } },
      payee: { select: { keyId: true, phone: true, bizNumberEnc: true, bankName: true, accountNumberEnc: true, accountHolder: true } },
    },
  }));

  return rows.map((r) => ({
    seqNo: r.seqNo,
    requesterName: r.requester.name ?? r.requester.email,
    entity: r.entity,
    clientName: r.client.name,
    bizName: r.bizName,
    payeeKeyId: r.payee?.keyId ?? "",
    phone: r.payee?.phone ?? "",
    bizNumber: r.payee ? decrypt(r.payee.bizNumberEnc) : "",
    bankName: r.payee?.bankName ?? "",
    accountNumber: r.payee ? decrypt(r.payee.accountNumberEnc) : "",
    accountHolder: r.payee?.accountHolder ?? "",
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
}

// PM 등록 화면에서 여러 행을 한 번에 저장한다. 사업자명/청구방식은 클라이언트 값을 신뢰하지
// 않고 저장 시점에 Payee 테이블에서 다시 조회한 값을 스냅샷으로 남긴다 — payeeId만 클라이언트가
// 정하고, 실제 표시값은 서버가 확정한다(변조·오염 방지). withRLS가 이미 $transaction으로
// 감싸므로, 존재/삭제 확인을 통과한 뒤 하나라도 insert가 실패(RLS 등)하면 자동으로 전체
// 롤백된다 — 별도 트랜잭션 처리가 필요 없다.
export async function createPaymentRequestsBulk(
  ctx: RlsContext,
  requesterId: string,
  inputs: PaymentRequestCreateInput[],
): Promise<ActionState> {
  return withRLS(ctx, async (tx) => {
    const payeeIds = [...new Set(inputs.map((i) => i.payeeId))];
    const payees = await tx.payee.findMany({
      where: { id: { in: payeeIds }, deletedAt: null },
      select: { id: true, bizName: true, taxType: true },
    });
    const payeeMap = new Map(payees.map((p) => [p.id, p]));
    if (payeeMap.size !== payeeIds.length) {
      return { ok: false, error: "선택한 사업자 중 존재하지 않거나 삭제된 항목이 있습니다. 다시 선택해 주세요." };
    }

    for (const input of inputs) {
      const payee = payeeMap.get(input.payeeId)!;
      const amount = (input.unitPrice + input.transportFee + input.materialFee) * input.count;
      await tx.paymentRequest.create({
        data: {
          requesterId,
          entity: input.entity,
          clientId: input.clientId,
          payeeId: input.payeeId,
          bizName: payee.bizName,
          unitPrice: input.unitPrice,
          transportFee: input.transportFee,
          materialFee: input.materialFee,
          count: input.count,
          amount,
          taxType: payee.taxType,
          memo: input.memo,
        },
      });
    }
    return { ok: true };
  });
}

export type PaymentRequestBulkUpdateResult = { updated: number; notFoundSeqNos: number[] };

// 엑셀 재업로드 반영 전용. seqNo로 대상을 찾아 payDate/status만 갱신한다(다른 필드는 건드리지
// 않음). 존재하지 않거나 소프트 삭제된 seqNo는 notFoundSeqNos로 보고 — 호출부(서버 액션)가
// 업로드 파일의 원래 행 번호로 역매핑해 사용자에게 안내한다.
export async function updatePaymentRequestsBulk(
  ctx: RlsContext,
  updates: { seqNo: number; payDate: Date | null; status: PaymentRequestStatus }[],
): Promise<PaymentRequestBulkUpdateResult> {
  return withRLS(ctx, async (tx) => {
    const seqNos = updates.map((u) => u.seqNo);
    const found = await tx.paymentRequest.findMany({
      where: { seqNo: { in: seqNos }, deletedAt: null },
      select: { id: true, seqNo: true },
    });
    const idBySeqNo = new Map(found.map((f) => [f.seqNo, f.id]));

    let updated = 0;
    const notFoundSeqNos: number[] = [];
    for (const u of updates) {
      const id = idBySeqNo.get(u.seqNo);
      if (!id) { notFoundSeqNos.push(u.seqNo); continue; }
      await tx.paymentRequest.update({ where: { id }, data: { payDate: u.payDate, status: u.status } });
      updated++;
    }
    return { updated, notFoundSeqNos };
  });
}
