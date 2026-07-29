import type { Payee, PayeeType, TaxType, Prisma } from "@prisma/client";
import { withRLS, type RlsContext } from "@/lib/rls";
import { decrypt, encrypt, blindIndex, digitsOnly, maskAccountNumber } from "@/lib/crypto/payee-secret";
import type { ActionState } from "@/lib/action-state";

export const PAYEE_SEARCH_FIELDS = ["bizName", "bizNumber", "keyId"] as const;
export type PayeeSearchField = (typeof PAYEE_SEARCH_FIELDS)[number];

// PM 화면 전용 검색 필드 — 사업자번호 대신 연락처를 검색할 수 있다.
export const PAYEE_SEARCH_FIELDS_PM = ["bizName", "keyId", "phone"] as const;
export type PayeePmSearchField = (typeof PAYEE_SEARCH_FIELDS_PM)[number];

export type PayeeSearchFilter = { field: PayeeSearchField | PayeePmSearchField; q: string };

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

// listPayees/listPayeesForExport/listPayeesForPm 공통: 조회 + 인메모리 검색 필터링.
// role 가드는 두지 않는다(모듈 내부 전용 함수) — 각 공개 함수가 자기 role을 직접 검증한다.
function fetchMatchedPayees(ctx: RlsContext, filter?: PayeeSearchFilter): Promise<MatchedPayee[]> {
  return withRLS(ctx, async (tx) => {
    const rows = await tx.payee.findMany({
      where: { deletedAt: null },
      orderBy: { keyId: "asc" },
      include: { attachments: { select: { fileType: true } } },
    });
    const q = filter?.q.trim();
    if (!filter || !q) return rows;
    return rows.filter((r) => {
      if (filter.field === "bizName") return r.bizName.toLowerCase().includes(q.toLowerCase());
      if (filter.field === "keyId") return r.keyId.toLowerCase().includes(q.toLowerCase());
      if (filter.field === "phone") {
        // 검색어가 URL 쿼리스트링에 그대로 남으므로, 사업자번호 검색과 동일한 이유로 앞 6자리까지만 사용한다.
        const qDigits = digitsOnly(q).slice(0, 6);
        return r.phoneNormalized.includes(qDigits);
      }
      // 검색어가 URL 쿼리스트링에 그대로 남으므로(GET 폼), 원문 전체 노출 위험을 줄이기 위해
      // 사업자번호 검색은 앞 6자리까지만 사용한다.
      const qDigits = digitsOnly(q).slice(0, 6);
      return digitsOnly(decrypt(r.bizNumberEnc)).includes(qDigits);
    });
  });
}

export async function listPayees(ctx: RlsContext, filter?: PayeeSearchFilter): Promise<PayeeRow[]> {
  if (ctx.role !== "ADMIN" && ctx.role !== "SETTLEMENT") {
    throw new Error("지급 리스트 원문 조회 권한이 없습니다.");
  }
  const rows = await fetchMatchedPayees(ctx, filter);
  return rows.map((r) => ({
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
}

export async function listPayeesForExport(ctx: RlsContext, filter?: PayeeSearchFilter): Promise<PayeeExportRow[]> {
  if (ctx.role !== "ADMIN" && ctx.role !== "SETTLEMENT") {
    throw new Error("지급 리스트 원문 조회 권한이 없습니다.");
  }
  const rows = await fetchMatchedPayees(ctx, filter);
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

// 지급 리스트 소프트 삭제 — 개별/일괄 모두 이 함수 하나로 처리(ids 길이 1 또는 N).
// 이미 삭제됐거나 존재하지 않는 id가 섞여도 나머지는 정상 삭제되고, count가 0일 때만 실패로 본다.
export function softDeletePayees(ctx: RlsContext, ids: string[]): Promise<ActionState> {
  return withRLS(ctx, async (tx) => {
    if (ctx.role !== "ADMIN" && ctx.role !== "SETTLEMENT") {
      throw new Error("지급 리스트 삭제 권한이 없습니다.");
    }
    const result = await tx.payee.updateMany({
      where: { id: { in: ids }, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (result.count === 0) return { ok: false, error: "삭제할 항목을 찾을 수 없습니다." };
    return { ok: true };
  });
}
