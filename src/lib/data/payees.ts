import type { Payee, PayeeType, TaxType, Prisma } from "@prisma/client";
import { withRLS, type RlsContext } from "@/lib/rls";
import { decrypt, encrypt, blindIndex, digitsOnly, maskAccountNumber, maskPhone, maskFully } from "@/lib/crypto/payee-secret";
import type { ActionState } from "@/lib/action-state";

export const PAYEE_SEARCH_FIELDS = ["bizName", "bizNumber", "keyId"] as const;
export type PayeeSearchField = (typeof PAYEE_SEARCH_FIELDS)[number];

// PM 화면 전용 검색 필드 — 사업자번호 대신 연락처를 검색할 수 있다.
export const PAYEE_SEARCH_FIELDS_PM = ["bizName", "keyId", "phone"] as const;
export type PayeePmSearchField = (typeof PAYEE_SEARCH_FIELDS_PM)[number];

export type PayeeSearchFilter = { field: PayeeSearchField | PayeePmSearchField; q: string };

export const PAGE_SIZE = 50;

// URL 쿼리 파라미터(page)를 파싱. 1 미만이거나 정수가 아니면 1(첫 페이지)로 클램프.
export function parsePage(value: string | undefined): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return 1;
  return n;
}

// 알 수 없는 field 값(URL 조작 등)은 undefined 반환 — 호출부가 필터를 완전히 무시하도록.
export function parsePayeeSearchField(value: string | undefined): PayeeSearchField | undefined {
  return PAYEE_SEARCH_FIELDS.find((f) => f === value);
}

export function parsePayeePmSearchField(value: string | undefined): PayeePmSearchField | undefined {
  return PAYEE_SEARCH_FIELDS_PM.find((f) => f === value);
}

// 저장 직전 형태(keyId 제외 — 채번은 createPayeesBulk가 담당).
export type PayeeCreateInput = {
  payeeType: PayeeType;
  bizName: string;
  bizNumberEnc: string;
  bizNumberMasked: string;
  bizNumberBidx: string;
  phone: string;
  phoneNormalized: string;
  bankName: string;
  accountNumberEnc: string;
  accountNumberMasked: string;
  accountHolder: string;
  taxType: TaxType;
};

// 지급 리스트 화면용(ADMIN·SETTLEMENT 전용) — 첨부 존재 배지 + 화면이 실제로 그리는 값만.
// 사업자번호/주민번호는 화면이 마스킹만 표시하므로 원문을 담지 않는다(클라이언트 컴포넌트로
// 넘어가면 RSC 페이로드에 실려 브라우저까지 전송되므로, 쓰지 않는 원문은 내보내지 않는다).
export type PayeeRow = {
  id: string;
  keyId: string;
  payeeType: PayeeType;
  bizName: string;
  bizNumberMasked: string; // 목록 표시용 마스킹
  phone: string;
  bankName: string;
  accountNumber: string; // 복호화 원문
  accountHolder: string;
  taxType: TaxType;
  hasBizCert: boolean;
  hasBankbook: boolean;
};

// 엑셀 다운로드 전용(ADMIN·SETTLEMENT 전용) — 사업자번호 원문을 포함한다.
// 이 화면에 도달 가능한 역할이 이미 ADMIN/SETTLEMENT뿐이므로 별도 역할 분기 없이
// listPayees와 동일한 role 체크(fetchMatchedPayees 내부)에 얹는다.
export type PayeeExportRow = {
  keyId: string;
  bizName: string;
  bizNumber: string; // 복호화 원문
  phone: string;
  bankName: string;
  accountNumber: string; // 복호화 원문
  accountHolder: string;
  taxType: TaxType;
  hasBizCert: boolean;
  hasBankbook: boolean;
};

const SEQ: Record<PayeeType, string> = {
  INSTRUCTOR: "payee_key_seq_instructor",
  VENDOR: "payee_key_seq_vendor",
};

const PREFIX: Record<PayeeType, string> = {
  INSTRUCTOR: "a",
  VENDOR: "b",
};

// 유형별 시퀀스에서 count개의 번호를 한 번의 쿼리로 받아 a###/b###로 변환.
async function nextKeyIds(tx: Prisma.TransactionClient, type: PayeeType, count: number): Promise<string[]> {
  const rows = await tx.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT nextval('${SEQ[type]}') AS n FROM generate_series(1, ${count})`,
  );
  return rows.map((r) => `${PREFIX[type]}${String(Number(r.n)).padStart(3, "0")}`);
}

// 유형별로 시퀀스 값을 한 번에 뽑아 채번(왕복 횟수를 N과 무관하게 고정)한 뒤 일괄 insert.
// bizNumberBidx 기준으로 파일 내 중복(첫 행 우선)과 DB 기존 활성 중복을 스킵한다.
// DB에 소프트 삭제된 행과 겹치면 스킵하지 않고 기존 keyId를 유지한 채 그 행을 복원(revive)한다.
export function createPayeesBulk(
  ctx: RlsContext,
  inputs: PayeeCreateInput[],
): Promise<{ created: number; skipped: number }> {
  return withRLS(ctx, async (tx) => {
    let skipped = 0;

    // 1) 파일 내 bizNumberBidx 중복 제거(첫 행 우선).
    const seen = new Set<string>();
    const deduped: PayeeCreateInput[] = [];
    for (const input of inputs) {
      if (seen.has(input.bizNumberBidx)) { skipped++; continue; }
      seen.add(input.bizNumberBidx);
      deduped.push(input);
    }

    // 2) DB에 이미 있는 bidx 처리 — 활성 행은 스킵, 소프트 삭제된 행은 복원(revive) 대상으로 분리.
    const bidxList = deduped.map((d) => d.bizNumberBidx);
    const existing = bidxList.length
      ? await tx.payee.findMany({
          where: { bizNumberBidx: { in: bidxList } },
          select: { id: true, bizNumberBidx: true, deletedAt: true },
        })
      : [];
    const existingMap = new Map(existing.map((e) => [e.bizNumberBidx, e]));
    const toInsert: PayeeCreateInput[] = [];
    const toRevive: { id: string; input: PayeeCreateInput }[] = [];
    for (const d of deduped) {
      const match = existingMap.get(d.bizNumberBidx);
      if (!match) { toInsert.push(d); continue; }
      if (match.deletedAt === null) { skipped++; continue; }
      toRevive.push({ id: match.id, input: d });
    }

    // 2-1) 복원 대상은 기존 keyId를 유지한 채 필드만 갱신(새 채번 없음).
    let revived = 0;
    for (const { id, input } of toRevive) {
      await tx.payee.update({
        where: { id },
        data: {
          payeeType: input.payeeType,
          bizName: input.bizName,
          bizNumberEnc: input.bizNumberEnc,
          bizNumberMasked: input.bizNumberMasked,
          phone: input.phone,
          phoneNormalized: input.phoneNormalized,
          bankName: input.bankName,
          accountNumberEnc: input.accountNumberEnc,
          accountNumberMasked: input.accountNumberMasked,
          accountHolder: input.accountHolder,
          taxType: input.taxType,
          deletedAt: null,
        },
      });
      revived++;
    }

    if (toInsert.length === 0) return { created: revived, skipped };

    // 3) 유형별로 채번 후 일괄 insert.
    const byType = new Map<PayeeType, number[]>();
    toInsert.forEach((input, i) => {
      const list = byType.get(input.payeeType) ?? [];
      list.push(i);
      byType.set(input.payeeType, list);
    });

    const keyIds = new Array<string>(toInsert.length);
    for (const [type, indices] of byType) {
      const ids = await nextKeyIds(tx, type, indices.length);
      indices.forEach((idx, j) => { keyIds[idx] = ids[j]; });
    }

    const data = toInsert.map((input, i) => ({ keyId: keyIds[i], ...input }));
    // ON CONFLICT DO NOTHING — 사전검사와 insert 사이 경합으로 들어온 중복도 DB가 스킵.
    const { count } = await tx.payee.createMany({ data, skipDuplicates: true });
    const raceSkipped = toInsert.length - count; // 경합으로 스킵된 행
    return { created: revived + count, skipped: skipped + raceSkipped };
  });
}

type MatchedPayee = Prisma.PayeeGetPayload<{
  include: { attachments: { select: { fileType: true } } };
}>;

type Pagination = { skip: number; take: number };

// listPayees/listPayeesForExport/listPayeesForPm 공통: 조회 + 필터링 + (옵션)페이지네이션.
// bizName/keyId/phone(phoneNormalized)은 평문(또는 정규화된 평문)이라 DB where절로 직접
// 필터링하고 skip/take로 페이지네이션한다. bizNumber는 암호화되어 있어 정확일치 전용
// 블라인드 인덱스로는 부분검색이 불가능하므로, 전체 조회 후 복호화한 값을 인메모리로
// 필터링한 뒤 필요하면 그 결과 배열을 슬라이스한다(이 경로는 페이지네이션 도입 여부와
// 무관하게 항상 전체 스캔 비용이 든다 — 기존 설계 제약, 이번 변경 범위 밖).
// role 가드는 두지 않는다(모듈 내부 전용 함수) — 각 공개 함수가 자기 role을 직접 검증한다.
function fetchMatchedPayees(
  ctx: RlsContext,
  filter?: PayeeSearchFilter,
  pagination?: Pagination,
): Promise<{ rows: MatchedPayee[]; totalCount: number }> {
  return withRLS(ctx, async (tx) => {
    const q = filter?.q.trim();

    if (filter && q && filter.field === "bizNumber") {
      const all = await tx.payee.findMany({
        where: { deletedAt: null },
        orderBy: { keyId: "asc" },
        include: { attachments: { select: { fileType: true } } },
      });
      // 검색어가 URL 쿼리스트링에 그대로 남으므로(GET 폼), 원문 전체 노출 위험을 줄이기 위해
      // 사업자번호 검색은 앞 6자리까지만 사용한다.
      const qDigits = digitsOnly(q).slice(0, 6);
      const filtered = all.filter((r) => digitsOnly(decrypt(r.bizNumberEnc)).includes(qDigits));
      const rows = pagination ? filtered.slice(pagination.skip, pagination.skip + pagination.take) : filtered;
      return { rows, totalCount: filtered.length };
    }

    const where: Prisma.PayeeWhereInput = { deletedAt: null };
    if (filter && q) {
      if (filter.field === "bizName") {
        where.bizName = { contains: q, mode: "insensitive" };
      } else if (filter.field === "keyId") {
        where.keyId = { contains: q, mode: "insensitive" };
      } else if (filter.field === "phone") {
        // 검색어가 URL 쿼리스트링에 그대로 남으므로, 사업자번호 검색과 동일한 이유로 앞 6자리까지만 사용한다.
        const qDigits = digitsOnly(q).slice(0, 6);
        where.phoneNormalized = { contains: qDigits };
      }
    }

    const [rows, totalCount] = await Promise.all([
      tx.payee.findMany({
        where,
        orderBy: { keyId: "asc" },
        include: { attachments: { select: { fileType: true } } },
        ...(pagination ? { skip: pagination.skip, take: pagination.take } : {}),
      }),
      tx.payee.count({ where }),
    ]);
    return { rows, totalCount };
  });
}

export type PayeePage<T> = { rows: T[]; page: number; totalPages: number };

export async function listPayees(ctx: RlsContext, filter?: PayeeSearchFilter, page = 1): Promise<PayeePage<PayeeRow>> {
  if (ctx.role !== "ADMIN" && ctx.role !== "SETTLEMENT") {
    throw new Error("지급 리스트 원문 조회 권한이 없습니다.");
  }
  let { rows, totalCount } = await fetchMatchedPayees(ctx, filter, { skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  // 삭제 등으로 결과가 줄어 요청한 page가 범위를 벗어나면 마지막 페이지로 클램프해 재조회한다
  // (그래야 UI가 빈 목록 + 갈 곳 없는 페이저를 보여주는 막다른 상태에 빠지지 않는다).
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  if (clampedPage !== page) {
    ({ rows, totalCount } = await fetchMatchedPayees(ctx, filter, { skip: (clampedPage - 1) * PAGE_SIZE, take: PAGE_SIZE }));
  }
  const mapped = rows.map((r) => ({
    id: r.id,
    keyId: r.keyId,
    payeeType: r.payeeType,
    bizName: r.bizName,
    bizNumberMasked: r.bizNumberMasked,
    phone: r.phone,
    bankName: r.bankName,
    accountNumber: decrypt(r.accountNumberEnc),
    accountHolder: r.accountHolder,
    taxType: r.taxType,
    hasBizCert: r.attachments.some((a) => a.fileType === "BIZ_CERT"),
    hasBankbook: r.attachments.some((a) => a.fileType === "BANKBOOK"),
  }));
  return { rows: mapped, page: clampedPage, totalPages };
}

export async function listPayeesForExport(ctx: RlsContext, filter?: PayeeSearchFilter): Promise<PayeeExportRow[]> {
  if (ctx.role !== "ADMIN" && ctx.role !== "SETTLEMENT") {
    throw new Error("지급 리스트 원문 조회 권한이 없습니다.");
  }
  const { rows } = await fetchMatchedPayees(ctx, filter);
  return rows.map((r) => ({
    keyId: r.keyId,
    bizName: r.bizName,
    bizNumber: decrypt(r.bizNumberEnc),
    phone: r.phone,
    bankName: r.bankName,
    accountNumber: decrypt(r.accountNumberEnc),
    accountHolder: r.accountHolder,
    taxType: r.taxType,
    hasBizCert: r.attachments.some((a) => a.fileType === "BIZ_CERT"),
    hasBankbook: r.attachments.some((a) => a.fileType === "BANKBOOK"),
  }));
}

// PM용 지급 리스트 화면 — 사업자번호/주민번호 대신 연락처(중간 4자리 마스킹),
// 은행명/계좌번호/예금주는 값 길이만큼 전체 마스킹. 원문은 어떤 필드에도 담기지 않는다.
export type PayeePmRow = {
  id: string;
  keyId: string;
  payeeType: PayeeType;
  bizName: string;
  phoneMasked: string;
  bankNameMasked: string;
  accountNumberMasked: string;
  accountHolderMasked: string;
  taxType: TaxType;
  hasBizCert: boolean;
  hasBankbook: boolean;
};

export async function listPayeesForPm(ctx: RlsContext, filter?: PayeeSearchFilter, page = 1): Promise<PayeePage<PayeePmRow>> {
  if (ctx.role !== "PM") {
    throw new Error("PM 지급 리스트 조회 권한이 없습니다.");
  }
  let { rows, totalCount } = await fetchMatchedPayees(ctx, filter, { skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  // 삭제 등으로 결과가 줄어 요청한 page가 범위를 벗어나면 마지막 페이지로 클램프해 재조회한다
  // (그래야 UI가 빈 목록 + 갈 곳 없는 페이저를 보여주는 막다른 상태에 빠지지 않는다).
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  if (clampedPage !== page) {
    ({ rows, totalCount } = await fetchMatchedPayees(ctx, filter, { skip: (clampedPage - 1) * PAGE_SIZE, take: PAGE_SIZE }));
  }
  const mapped = rows.map((r) => ({
    id: r.id,
    keyId: r.keyId,
    payeeType: r.payeeType,
    bizName: r.bizName,
    phoneMasked: maskPhone(digitsOnly(r.phone)),
    bankNameMasked: maskFully(r.bankName),
    accountNumberMasked: maskFully(decrypt(r.accountNumberEnc)),
    accountHolderMasked: maskFully(r.accountHolder),
    taxType: r.taxType,
    hasBizCert: r.attachments.some((a) => a.fileType === "BIZ_CERT"),
    hasBankbook: r.attachments.some((a) => a.fileType === "BANKBOOK"),
  }));
  return { rows: mapped, page: clampedPage, totalPages };
}

export function findPayeeByBizNumber(ctx: RlsContext, bizNumberPlain: string): Promise<Payee[]> {
  return withRLS(ctx, (tx) =>
    tx.payee.findMany({ where: { bizNumberBidx: blindIndex(digitsOnly(bizNumberPlain)) } }),
  );
}

// 첨부파일 표시/다운로드 이름("고유번호_업체명_구분")을 만들 때만 필요한 최소 조회.
export function getPayeeKeyAndName(ctx: RlsContext, payeeId: string): Promise<{ keyId: string; bizName: string } | null> {
  return withRLS(ctx, (tx) => tx.payee.findUnique({ where: { id: payeeId }, select: { keyId: true, bizName: true } }));
}

// 지급 리스트 인라인 수정 — 사업자번호(민감정보)와 고유번호/유형은 절대 변경하지 않는다.
export type PayeeUpdateInput = {
  bizName: string;
  bankName: string;
  accountNumber: string; // 평문(하이픈 등 포함 가능)
  accountHolder: string;
  taxType: TaxType;
};

export function updatePayee(ctx: RlsContext, id: string, input: PayeeUpdateInput): Promise<void> {
  const acctDigits = digitsOnly(input.accountNumber);
  return withRLS(ctx, async (tx) => {
    if (ctx.role !== "ADMIN" && ctx.role !== "SETTLEMENT") {
      throw new Error("지급 리스트 수정 권한이 없습니다.");
    }
    await tx.payee.update({
      where: { id },
      data: {
        bizName: input.bizName,
        bankName: input.bankName,
        accountNumberEnc: encrypt(acctDigits),
        accountNumberMasked: maskAccountNumber(acctDigits),
        accountHolder: input.accountHolder,
        taxType: input.taxType,
      },
    });
  });
}

// PM 전용 부분 수정 — 사업자명/청구방식만 바꾼다. 은행명/계좌번호/예금주는 data에 넣지 않으므로 그대로 유지된다.
export type PayeeUpdatePmInput = { bizName: string; taxType: TaxType };

export function updatePayeePmFields(ctx: RlsContext, id: string, input: PayeeUpdatePmInput): Promise<void> {
  return withRLS(ctx, async (tx) => {
    if (ctx.role !== "PM") {
      throw new Error("PM 지급 리스트 수정 권한이 없습니다.");
    }
    await tx.payee.update({ where: { id }, data: { bizName: input.bizName, taxType: input.taxType } });
  });
}

// 지급 리스트 소프트 삭제 — 개별/일괄 모두 이 함수 하나로 처리(ids 길이 1 또는 N).
// 이미 삭제됐거나 존재하지 않는 id가 섞여도 나머지는 정상 삭제되고, count가 0일 때만 실패로 본다.
// role 가드 없음 — ADMIN/SETTLEMENT/PM 모두 삭제 가능(서버 액션의 requireRole("PM")이 인가를 맡는다).
export function softDeletePayees(ctx: RlsContext, ids: string[]): Promise<ActionState> {
  return withRLS(ctx, async (tx) => {
    const result = await tx.payee.updateMany({
      where: { id: { in: ids }, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (result.count === 0) return { ok: false, error: "삭제할 항목을 찾을 수 없습니다." };
    return { ok: true };
  });
}

// 지급요청 등록 화면의 사업자명(이름) 검색 콤보박스용 — 민감정보(계좌/사업자번호) 없이
// id/keyId/bizName/taxType만. Payee의 SELECT RLS(payee_select)는 전 역할 허용이라 role 분기가
// 필요 없다. taxType은 지급요청 등록 시 청구방식을 자동 반영하고 호버 툴팁에 쓰기 위함(마스킹 대상 아님).
export type PayeeOption = { id: string; keyId: string; bizName: string; taxType: TaxType };

export function listPayeeOptions(ctx: RlsContext): Promise<PayeeOption[]> {
  return withRLS(ctx, (tx) =>
    tx.payee.findMany({
      where: { deletedAt: null },
      select: { id: true, keyId: true, bizName: true, taxType: true },
      orderBy: { bizName: "asc" },
    }),
  );
}
