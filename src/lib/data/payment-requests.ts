import type { PaymentRequestEntity, PaymentRequestStatus, Prisma, TaxType } from "@prisma/client";
import { withRLS, type RlsContext } from "@/lib/rls";
import type { ActionState } from "@/lib/action-state";
import type { PaymentRequestCreateInput } from "@/lib/payment-request-validation";
import { decrypt, blindIndex } from "@/lib/crypto/payee-secret";
import { TAX_TYPE_BY_LABEL } from "@/lib/labels";
import type { ParsedRegistrationRow } from "./payment-request-registration-upload";

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
  payeeId: string | null;
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
    payeeId: r.payeeId,
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
      select: { id: true, seqNo: true, payDate: true, status: true },
    });
    const bySeqNo = new Map(found.map((f) => [f.seqNo, f]));

    let updated = 0;
    const notFoundSeqNos: number[] = [];
    for (const u of updates) {
      const current = bySeqNo.get(u.seqNo);
      if (!current) { notFoundSeqNos.push(u.seqNo); continue; }
      // 재업로드 파일은 필터에 걸린 전체 행(대부분 미변경)을 담고 있을 수 있어, 실제로 값이
      // 달라진 행만 update한다 — 트랜잭션 타임아웃 방지 + updatedAt/반영 건수 정확도를 위해서다.
      const samePayDate = (current.payDate?.getTime() ?? null) === (u.payDate?.getTime() ?? null);
      const sameStatus = current.status === u.status;
      if (samePayDate && sameStatus) continue;
      await tx.paymentRequest.update({ where: { id: current.id }, data: { payDate: u.payDate, status: u.status } });
      updated++;
    }
    return { updated, notFoundSeqNos };
  });
}

export type PaymentRequestSettlementUpdateInput = {
  entity: PaymentRequestEntity;
  clientId: string;
  payeeId: string;
  payDate: Date | null;
  status: PaymentRequestStatus;
};

// 정산담당자 인라인 수정. payeeId로 Payee를 다시 조회해 bizName/taxType을 스냅샷으로
// 갱신한다(클라이언트가 보낸 이름은 신뢰하지 않음 — 등록 때와 동일 원칙). 상태 무관하게
// 항상 수정 가능(정산담당자는 최고 권한).
// payeeId가 기존 값과 동일(미변경)한데 그 Payee가 이후 소프트 삭제된 경우, 존재하지 않는
// 사업자로 취급해 저장을 막으면 정산담당자가 지급일/지급여부만 고치고 싶어도 손을 못 대게
// 된다. 이 경우엔 Payee를 다시 조회하지 않고 현재 행의 bizName/taxType을 그대로 유지한다.
// payeeId를 실제로 다른 값으로 바꾸는 경우엔 기존과 동일하게 소프트 삭제되지 않은 Payee만 허용한다.
export async function updatePaymentRequest(
  ctx: RlsContext,
  id: string,
  input: PaymentRequestSettlementUpdateInput,
): Promise<ActionState> {
  return withRLS(ctx, async (tx) => {
    const current = await tx.paymentRequest.findFirst({
      where: { id, deletedAt: null },
      select: { payeeId: true, bizName: true, taxType: true },
    });
    if (!current) return { ok: false, error: "수정할 항목을 찾을 수 없습니다." };

    let bizName: string;
    let taxType: TaxType;
    if (input.payeeId === current.payeeId) {
      bizName = current.bizName;
      taxType = current.taxType;
    } else {
      const payee = await tx.payee.findFirst({
        where: { id: input.payeeId, deletedAt: null },
        select: { bizName: true, taxType: true },
      });
      if (!payee) return { ok: false, error: "선택한 사업자를 찾을 수 없습니다. 다시 선택해 주세요." };
      bizName = payee.bizName;
      taxType = payee.taxType;
    }

    await tx.paymentRequest.update({
      where: { id },
      data: {
        entity: input.entity,
        clientId: input.clientId,
        payeeId: input.payeeId,
        bizName,
        taxType,
        payDate: input.payDate,
        status: input.status,
      },
    });
    return { ok: true };
  });
}

export type PaymentRequestPmUpdateInput = {
  entity: PaymentRequestEntity;
  clientId: string;
  payeeId: string;
  unitPrice: number;
  transportFee: number;
  materialFee: number;
  count: number;
  memo: string;
};

// PM 상세수정. 지급준비 상태 + 본인 신청 건인지를 이 함수가 직접 재검증한다 — DB RLS
// (payment_request_update_pm)는 requesterId만 검사하고 상태는 걸러주지 않으므로, 이
// 앱 레이어 체크가 없으면 PM이 지급완료 건도 수정할 수 있게 된다. amount는 서버가
// (unitPrice+transportFee+materialFee)*count로 재계산한다.
export async function updatePaymentRequestPmFields(
  ctx: RlsContext,
  id: string,
  input: PaymentRequestPmUpdateInput,
): Promise<ActionState> {
  return withRLS(ctx, async (tx) => {
    const current = await tx.paymentRequest.findFirst({
      where: { id, deletedAt: null },
      select: { status: true, requesterId: true, payeeId: true, bizName: true, taxType: true },
    });
    if (!current || current.status !== "PREPARING" || current.requesterId !== ctx.userId) {
      return { ok: false, error: "수정할 수 없는 건입니다." };
    }

    // payeeId가 기존과 동일한데 그 Payee가 이후 소프트 삭제된 경우엔 재조회 없이 기존
    // bizName/taxType을 유지한다(updatePaymentRequest와 동일 원칙 — Important #1 참고).
    let bizName: string;
    let taxType: TaxType;
    if (input.payeeId === current.payeeId) {
      bizName = current.bizName;
      taxType = current.taxType;
    } else {
      const payee = await tx.payee.findFirst({
        where: { id: input.payeeId, deletedAt: null },
        select: { bizName: true, taxType: true },
      });
      if (!payee) return { ok: false, error: "선택한 사업자를 찾을 수 없습니다. 다시 선택해 주세요." };
      bizName = payee.bizName;
      taxType = payee.taxType;
    }

    const amount = (input.unitPrice + input.transportFee + input.materialFee) * input.count;
    await tx.paymentRequest.update({
      where: { id },
      data: {
        entity: input.entity,
        clientId: input.clientId,
        payeeId: input.payeeId,
        bizName,
        taxType,
        unitPrice: input.unitPrice,
        transportFee: input.transportFee,
        materialFee: input.materialFee,
        count: input.count,
        amount,
        memo: input.memo,
      },
    });
    return { ok: true };
  });
}

// 일괄수정(체크박스 선택 → 지급일/지급여부 동일 적용). id 기반이라 엑셀 재업로드용
// updatePaymentRequestsBulk(seqNo 기반, "찾은 것만 갱신")와는 별개다.
export async function updatePaymentRequestsByIds(
  ctx: RlsContext,
  ids: string[],
  input: { payDate: Date | null; status: PaymentRequestStatus },
): Promise<ActionState> {
  return withRLS(ctx, async (tx) => {
    const result = await tx.paymentRequest.updateMany({
      where: { id: { in: ids }, deletedAt: null },
      data: { payDate: input.payDate, status: input.status },
    });
    if (result.count === 0) return { ok: false, error: "수정할 항목을 찾을 수 없습니다." };
    return { ok: true };
  });
}

// 소프트 삭제. Payee의 softDeletePayees와 동일한 updateMany 패턴. opts.statusIn이 있으면
// 그 상태의 행만 대상으로 삼는다(PM 삭제 시 ["PREPARING"]을 넘겨 지급완료 건이 섞여도
// 삭제되지 않게 막는다). 매칭된 count가 ids.length보다 작으면(권한 없는 행이나 상태가
// 안 맞는 행이 섞여 있었다는 뜻) 부분삭제 대신 전체 실패로 처리한다 — 조용한 부분성공보다
// 명확한 에러가 낫다.
class PartialDeleteError extends Error {}

export async function softDeletePaymentRequests(
  ctx: RlsContext,
  ids: string[],
  opts?: { statusIn?: PaymentRequestStatus[] },
): Promise<ActionState> {
  // updateMany 전에 SELECT 기준(count)으로 매칭 건수를 미리 확인하는 방식은 쓸 수 없다 —
  // PaymentRequest의 SELECT RLS 정책(payment_request_select)은 PM이 "담당 고객사의 모든
  // 건"을 볼 수 있게 허용하지만, UPDATE 정책(payment_request_update_pm)은 그보다 좁게
  // "본인이 신청한 건"만 허용한다. 즉 count()로는 보이는데 실제 updateMany는 아무 것도
  // 바꾸지 못하는 행이 있을 수 있어, count 결과가 실제 삭제 가능 여부와 다를 수 있다.
  // 그래서 updateMany를 먼저 실행해 실제 영향받은 행 수를 확인하되, 부분 매칭(count가
  // ids.length보다 작음)이면 예외를 던져 트랜잭션 자체를 롤백시킨다 — withRLS(=$transaction)는
  // 콜백이 정상 반환하면 그대로 커밋하므로, { ok: false }를 그냥 반환하는 것만으로는 이미
  // 실행된 부분 삭제가 커밋되어 all-or-nothing이 깨진다.
  try {
    return await withRLS(ctx, async (tx) => {
      const where: Prisma.PaymentRequestWhereInput = { id: { in: ids }, deletedAt: null };
      if (opts?.statusIn) where.status = { in: opts.statusIn };

      const result = await tx.paymentRequest.updateMany({ where, data: { deletedAt: new Date() } });
      if (result.count === 0) return { ok: false, error: "삭제할 항목을 찾을 수 없습니다." };
      if (result.count < ids.length) throw new PartialDeleteError();
      return { ok: true };
    });
  } catch (e) {
    if (e instanceof PartialDeleteError) return { ok: false, error: "삭제할 수 없는 항목이 포함되어 있습니다." };
    throw e;
  }
}

export type PaymentRequestUploadCreateResult =
  | { ok: true; created: number }
  | { ok: false; errors: { row: number; message: string }[] };

// PM 엑셀 대량 등록 전용. 각 행의 고객사명을 조회하고, 사업자명+계좌번호가 지급 리스트와
// 모두 일치하는 대상이 있으면 연동(매칭된 Payee 값으로 덮어씀), 없으면 예외 건(신규 등록)으로
// 엑셀 값을 그대로 저장한다. 계좌번호 블라인드 인덱스에는 unique 제약이 없어(공동명의 계좌 등으로
// 겹칠 수 있음) 사업자명까지 함께 비교해 특정한다 — 계좌번호만으로 좁힌 후보군에서 사업자명이
// 일치하는 것이 없으면 예외 건, 2개 이상이면 자동 선택 불가 오류로 처리한다.
// 매칭 오류가 하나라도 있으면 아직 insert 전이므로 그대로 반환한다(all-or-nothing — 이미 쓴 것을
// 롤백할 필요가 없다, softDeletePaymentRequests의 PartialDeleteError 패턴과 달리 여기선 "쓰기 전에
// 미리 전부 확인"하는 방식이라 트랜잭션 예외를 던질 필요가 없다).
export async function createPaymentRequestsFromUpload(
  ctx: RlsContext,
  requesterId: string,
  rows: { row: number; data: ParsedRegistrationRow }[],
): Promise<PaymentRequestUploadCreateResult> {
  return withRLS(ctx, async (tx) => {
    const errors: { row: number; message: string }[] = [];
    const resolved: {
      entity: PaymentRequestEntity; clientId: string; payeeId: string | null;
      bizName: string; taxType: TaxType; unitPrice: number; transportFee: number;
      materialFee: number; count: number; memo: string;
    }[] = [];

    // 행마다 DB 조회를 던지면 큰 배치에서 Prisma 인터랙티브 트랜잭션 타임아웃(기본 5000ms)에
    // 걸릴 수 있어, 다른 대량 등록 함수들(createPaymentRequestsBulk, createPayeesBulk)과
    // 동일하게 조회를 루프 밖에서 한 번씩만 배치로 실행한다.
    const clientNames = [...new Set(rows.map((r) => r.data.clientName))];
    const clientsByName = new Map<string, { id: string }[]>();
    if (clientNames.length > 0) {
      const clients = await tx.client.findMany({
        where: { name: { in: clientNames }, deletedAt: null },
        select: { id: true, name: true },
      });
      for (const c of clients) {
        const list = clientsByName.get(c.name);
        if (list) list.push({ id: c.id });
        else clientsByName.set(c.name, [{ id: c.id }]);
      }
    }

    // 계좌번호 블라인드 인덱스로 후보만 배치 조회 — 최종 확정은 사업자명까지 함께 비교(아래 루프).
    const accountBidxList = [...new Set(rows.map((r) => blindIndex(r.data.accountNumberDigits)))];
    const payeesByAccountBidx = new Map<string, { id: string; bizName: string; taxType: TaxType }[]>();
    if (accountBidxList.length > 0) {
      const payees = await tx.payee.findMany({
        where: { accountNumberBidx: { in: accountBidxList }, deletedAt: null },
        select: { id: true, accountNumberBidx: true, bizName: true, taxType: true },
      });
      for (const p of payees) {
        const list = payeesByAccountBidx.get(p.accountNumberBidx);
        const entry = { id: p.id, bizName: p.bizName, taxType: p.taxType };
        if (list) list.push(entry);
        else payeesByAccountBidx.set(p.accountNumberBidx, [entry]);
      }
    }

    for (const { row, data } of rows) {
      const clients = clientsByName.get(data.clientName) ?? [];
      if (clients.length === 0) {
        errors.push({ row, message: `등록되지 않은 고객사명입니다: ${data.clientName}` });
        continue;
      }
      if (clients.length > 1) {
        errors.push({ row, message: `동일한 이름의 고객사가 여러 건 있어 자동 선택할 수 없습니다: ${data.clientName}` });
        continue;
      }

      const candidates = payeesByAccountBidx.get(blindIndex(data.accountNumberDigits)) ?? [];
      const matches = candidates.filter((c) => c.bizName === data.bizNameRaw);
      if (matches.length > 1) {
        errors.push({ row, message: "사업자명과 계좌번호가 여러 지급 대상과 일치해 자동 선택할 수 없습니다." });
        continue;
      }
      const payee = matches[0] ?? null;

      // payee가 null이면 파서가 이미 taxTypeRaw를 유효한 라벨로 검증해뒀다(예외 건, 항상 필수 입력).
      const taxType = payee ? payee.taxType : TAX_TYPE_BY_LABEL[data.taxTypeRaw as keyof typeof TAX_TYPE_BY_LABEL];
      resolved.push({
        entity: data.entity,
        clientId: clients[0].id,
        payeeId: payee?.id ?? null,
        bizName: payee?.bizName ?? data.bizNameRaw,
        taxType,
        unitPrice: data.unitPrice,
        transportFee: data.transportFee,
        materialFee: data.materialFee,
        count: data.count,
        memo: data.memo,
      });
    }

    if (errors.length > 0) return { ok: false, errors };

    for (const r of resolved) {
      const amount = (r.unitPrice + r.transportFee + r.materialFee) * r.count;
      await tx.paymentRequest.create({
        data: {
          requesterId, entity: r.entity, clientId: r.clientId, payeeId: r.payeeId,
          bizName: r.bizName, unitPrice: r.unitPrice, transportFee: r.transportFee,
          materialFee: r.materialFee, count: r.count, amount, taxType: r.taxType, memo: r.memo,
        },
      });
    }
    return { ok: true, created: resolved.length };
  });
}
