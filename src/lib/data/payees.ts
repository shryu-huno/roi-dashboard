import type { Payee, PayeeType, TaxType, Prisma } from "@prisma/client";
import { withRLS, type RlsContext } from "@/lib/rls";
import { decrypt, blindIndex, digitsOnly } from "@/lib/crypto/payee-secret";

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
// bizNumberBidx 기준으로 파일 내 중복(첫 행 우선)과 DB 기존 중복을 스킵한다.
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

    // 2) DB에 이미 있는 bidx 스킵.
    const bidxList = deduped.map((d) => d.bizNumberBidx);
    const existing = bidxList.length
      ? await tx.payee.findMany({
          where: { bizNumberBidx: { in: bidxList } },
          select: { bizNumberBidx: true },
        })
      : [];
    const existingSet = new Set(existing.map((e) => e.bizNumberBidx));
    const toInsert = deduped.filter((d) => {
      if (existingSet.has(d.bizNumberBidx)) { skipped++; return false; }
      return true;
    });
    if (toInsert.length === 0) return { created: 0, skipped };

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
    return { created: count, skipped: skipped + raceSkipped };
  });
}

export function listPayees(ctx: RlsContext): Promise<PayeeRow[]> {
  if (ctx.role !== "ADMIN" && ctx.role !== "SETTLEMENT") {
    throw new Error("지급 리스트 원문 조회 권한이 없습니다.");
  }
  return withRLS(ctx, async (tx) => {
    const rows = await tx.payee.findMany({
      orderBy: { keyId: "asc" },
      include: { attachments: { select: { fileType: true } } },
    });
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
  });
}

export function findPayeeByBizNumber(ctx: RlsContext, bizNumberPlain: string): Promise<Payee[]> {
  return withRLS(ctx, (tx) =>
    tx.payee.findMany({ where: { bizNumberBidx: blindIndex(digitsOnly(bizNumberPlain)) } }),
  );
}
