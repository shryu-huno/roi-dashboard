# Payee(지급 대상자) 도메인 포팅 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `lsj-huno/payees`(공통 히스토리 없는 별개 저장소)에서 개발된 지급 대상자(강사/업체) 암호화 원장 + 엑셀 업로드 기능을, 원래 있어야 할 `shryu-huno/roi-dashboard`에 이식한다.

**Architecture:** payees 저장소에서 이미 검증된 코드 중 roi-dashboard에 대응 파일이 없는 것(암호화 모듈, 데이터 계층, 파싱 유틸, 업로드 액션, UI 컴포넌트, 테스트)은 **그대로 이식**한다. roi-dashboard에 이미 존재하는 파일(`schema.prisma`, `schemas.ts`, `labels.ts`, `csv.ts`, `expenses/page.tsx`, `package.json`, `.env.example`)은 **현재 내용 기준으로 손으로 병합**한다. `/expenses`는 탭 구조가 없었으므로 "전체내역/지급리스트" 2탭을 새로 도입한다.

**Tech Stack:** Next.js 16 App Router, Prisma 6 + PostgreSQL(RLS), zod, exceljs(신규 의존성), vitest.

## Global Constraints

- 경로 별칭 `@/*` → `src/*`.
- 서버액션은 `requireRole(...)` → `getRlsContext(user)` → zod `safeParse` → data-layer(`withRLS` 경유) → `revalidatePath` → `ActionState` 순서를 따른다 (`src/app/(app)/expenses/actions.ts` 참고 패턴).
- `requireRole(role: AppRole)`은 랭크 비교(`hasAtLeast`, `ADMIN(3) > SETTLEMENT(2) > PM(1)`)다. 배열이 아니라 **단일 role** 인자이며 `requireRole("SETTLEMENT")`을 호출하면 ADMIN도 통과한다.
- 새 테이블에 사용자 데이터를 두면 반드시 RLS(`ENABLE`+`FORCE ROW LEVEL SECURITY`, `current_setting('app.user_role', true)` 정책)를 마이그레이션에 포함한다.
- 금액/식별자 외 문자열은 기존 한국어 주석 스타일을 따른다. 새 코드에 불필요한 주석을 추가하지 않는다(이식 코드는 원본 주석 유지).
- 테스트는 실제 Postgres가 필요하다 (`test/global-setup.ts`가 `prisma migrate deploy` 자동 실행). 로컬 `.env.test`에 `DATABASE_URL`, `PAYEE_ENC_KEY`, `PAYEE_BIDX_KEY`가 이미 설정되어 있음(확인됨) — 새로 발급하지 않는다.
- 범위 제외: `PayeeAttachment` 실제 파일 업로드 플로우, `PAYEE_ENC_KEY`/`PAYEE_BIDX_KEY` 운영 환경 등록, "지급요청/법인카드/개인카드" 준비중 탭.

---

### Task 1: Prisma 스키마 + 마이그레이션(Payee/PayeeAttachment + RLS)

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_payee_models/migration.sql` (Prisma가 생성, 수동 보완)
- Test: `test/payee-rls.test.ts`

**Interfaces:**
- Produces: Prisma 모델 `Payee`(`id, keyId, payeeType, bizName, bizNumberEnc, bizNumberMasked, bizNumberBidx, phone, phoneNormalized, bankName, accountNumberEnc, accountNumberMasked, accountHolder, taxType, createdAt, updatedAt, attachments`), `PayeeAttachment`(`id, payeeId, fileType, fileUrl, fileName, uploadedAt`), enum `PayeeType`(INSTRUCTOR/VENDOR), `TaxType`(6종), `PayeeFileType`(BIZ_CERT/BANKBOOK).시퀀스 `payee_key_seq_instructor`, `payee_key_seq_vendor`.

- [ ] **Step 1: `prisma/schema.prisma`에 enum 3종 추가**

`enum ExpenseCategory { ... }` 블록 바로 뒤(46번째 줄, `model User` 앞)에 삽입:

```prisma
enum PayeeType {
  INSTRUCTOR // 강사 (주민등록번호 13자리, keyId a###)
  VENDOR     // 업체 (사업자등록번호 10자리, keyId b###)
}

enum TaxType {
  TAX_INVOICE         // 세금계산서
  TAX_FREE_INVOICE    // 면세계산서
  CASH_RECEIPT        // 현금영수증
  HANDWRITTEN_INVOICE // 수기계산서
  BUSINESS_INCOME     // 사업소득
  OTHER_INCOME        // 기타소득
}

enum PayeeFileType {
  BIZ_CERT // 사업자등록증
  BANKBOOK // 통장사본
}
```

- [ ] **Step 2: `model Expense { ... }` 뒤(현재 175번째 줄, `// --- Auth.js` 주석 앞)에 모델 2개 추가**

```prisma
// 지급 대상 원장(공용). 정산담당자/관리자가 엑셀로 업로드. 민감정보는 앱 계층 암호화.
model Payee {
  id                  String    @id @default(cuid())
  keyId               String    @unique // 표시 고유번호 a001/b001 (앱이 시퀀스로 채번)
  payeeType           PayeeType          // 강사/업체 (번호 길이로 파생)
  bizName             String             // 사업자명/이름
  bizNumberEnc        String             // 사업자번호/주민번호 AES-GCM 암호문
  bizNumberMasked     String             // 마스킹 표시값 (900101-1****** / 123-45-6****)
  bizNumberBidx       String    @unique  // HMAC 블라인드 인덱스 (정확일치 검색 + 중복 방지)
  phone               String             // 강사·업체 공통 연락처
  phoneNormalized     String             // 하이픈 제거 검색용 (앱이 채움)
  bankName            String
  accountNumberEnc    String             // 계좌번호 AES-GCM 암호문
  accountNumberMasked String             // ****1234
  accountHolder       String             // 예금주
  taxType             TaxType            // 청구방식
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt

  attachments         PayeeAttachment[]

  @@index([phoneNormalized])
  @@index([payeeType])
}

// 지급 대상 첨부(사업자등록증/통장사본). 실제 업로드 흐름은 추후 단계.
model PayeeAttachment {
  id         String        @id @default(cuid())
  payeeId    String
  payee      Payee         @relation(fields: [payeeId], references: [id], onDelete: Cascade)
  fileType   PayeeFileType
  fileUrl    String
  fileName   String
  uploadedAt DateTime      @default(now())

  @@index([payeeId])
}
```

- [ ] **Step 3: 마이그레이션 스켈레톤 생성(적용은 아직 안 함)**

Run: `npx prisma migrate dev --name add_payee_models --create-only`
Expected: `prisma/migrations/<timestamp>_add_payee_models/migration.sql` 생성. `CreateEnum`(3개) / `CreateTable`(Payee, PayeeAttachment) / `CreateIndex`(keyId unique, bizNumberBidx unique, phoneNormalized, payeeType, payeeId) / `AddForeignKey` 문이 자동 생성됨.

- [ ] **Step 4: 생성된 migration.sql 파일 맨 끝에 시퀀스 + RLS 블록 수동 추가**

```sql
-- keyId 채번용 시퀀스 (강사 a###, 업체 b###). 앱이 nextval로 원자적 채번 → 동시/대량 업로드 안전.
CREATE SEQUENCE "payee_key_seq_instructor";
CREATE SEQUENCE "payee_key_seq_vendor";

-- RLS: 전체 공용 원장 — 전 역할 SELECT 허용, 쓰기(INSERT/UPDATE/DELETE)는 ADMIN·SETTLEMENT만.
ALTER TABLE "Payee" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payee" FORCE ROW LEVEL SECURITY;
CREATE POLICY payee_select ON "Payee" FOR SELECT USING (true);
CREATE POLICY payee_write ON "Payee"
  USING (current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT'))
  WITH CHECK (current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT'));

ALTER TABLE "PayeeAttachment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayeeAttachment" FORCE ROW LEVEL SECURITY;
CREATE POLICY payee_attachment_select ON "PayeeAttachment" FOR SELECT USING (true);
CREATE POLICY payee_attachment_write ON "PayeeAttachment"
  USING (current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT'))
  WITH CHECK (current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT'));
```

- [ ] **Step 5: 마이그레이션 적용 + Prisma Client 재생성**

Run: `npx prisma migrate dev`
Expected: `Applying migration ...add_payee_models` 후 `Your database is now in sync with your schema.` `@prisma/client`에 `Payee`/`PayeeAttachment`/`PayeeType`/`TaxType`/`PayeeFileType` 타입 노출.

- [ ] **Step 6: RLS 테스트 작성**

Create `test/payee-rls.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS } from "@/lib/rls";

const ADMIN = { userId: "seed-admin", role: "ADMIN" as const };

async function reset() {
  await withRLS(ADMIN, async (tx) => {
    await tx.payeeAttachment.deleteMany();
    await tx.payee.deleteMany();
  });
  await prisma.user.deleteMany();
}

function samplePayee(keyId: string) {
  return {
    keyId,
    payeeType: "VENDOR" as const,
    bizName: "테스트업체",
    bizNumberEnc: "enc",
    bizNumberMasked: "123-45-6****",
    bizNumberBidx: "bidx",
    phone: "01012345678",
    phoneNormalized: "01012345678",
    bankName: "국민",
    accountNumberEnc: "enc2",
    accountNumberMasked: "****1234",
    accountHolder: "홍길동",
    taxType: "TAX_INVOICE" as const,
  };
}

describe("Payee RLS — 공용 원장", () => {
  beforeEach(reset);

  it("SETTLEMENT은 등록할 수 있다", async () => {
    const created = await withRLS({ userId: "s1", role: "SETTLEMENT" }, (tx) =>
      tx.payee.create({ data: samplePayee("b001") }),
    );
    expect(created.keyId).toBe("b001");
  });

  it("PM은 전체 원장을 읽을 수 있다(공용)", async () => {
    await withRLS(ADMIN, (tx) => tx.payee.create({ data: samplePayee("b002") }));
    const rows = await withRLS({ userId: "pm1", role: "PM" }, (tx) => tx.payee.findMany());
    expect(rows.length).toBe(1);
  });

  it("PM은 등록할 수 없다(WITH CHECK)", async () => {
    await expect(
      withRLS({ userId: "pm1", role: "PM" }, (tx) => tx.payee.create({ data: samplePayee("b003") })),
    ).rejects.toThrow(/로우 단위 보안 정책|row-level security/i);
  });
});
```

- [ ] **Step 7: 테스트 실행 및 통과 확인**

Run: `npx vitest run test/payee-rls.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 8: 커밋**

```bash
git add prisma/schema.prisma prisma/migrations test/payee-rls.test.ts
git commit -m "feat(payees): Payee/PayeeAttachment 모델 + RLS 마이그레이션"
```

---

### Task 2: 암호화 모듈(`src/lib/crypto/payee-secret.ts`)

**Files:**
- Create: `src/lib/crypto/payee-secret.ts`
- Test: `test/payee-secret.test.ts`

**Interfaces:**
- Consumes: `process.env.PAYEE_ENC_KEY`, `process.env.PAYEE_BIDX_KEY` (base64, 이미 `.env.test`/로컬 `.env`에 설정됨).
- Produces: `encrypt(plain: string): string`, `decrypt(stored: string): string`, `digitsOnly(v: string): string`, `blindIndex(normalized: string): string`, `derivePayeeType(bizNumberDigits: string): PayeeType | null`, `maskBizNumber(digits: string, type: PayeeType): string`, `maskAccountNumber(digits: string): string`.

- [ ] **Step 1: 파일 생성**

Create `src/lib/crypto/payee-secret.ts`:

```typescript
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import type { PayeeType } from "@prisma/client";

function encKey(): Buffer {
  const raw = process.env.PAYEE_ENC_KEY;
  if (!raw) throw new Error("PAYEE_ENC_KEY 환경변수가 없습니다.");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("PAYEE_ENC_KEY는 base64 32바이트여야 합니다.");
  return key;
}

function bidxKey(): Buffer {
  const raw = process.env.PAYEE_BIDX_KEY;
  if (!raw) throw new Error("PAYEE_BIDX_KEY 환경변수가 없습니다.");
  const key = Buffer.from(raw, "base64");
  if (key.length < 32) throw new Error("PAYEE_BIDX_KEY는 base64 32바이트 이상이어야 합니다.");
  return key;
}

// AES-256-GCM. 저장형: "ivB64:tagB64:ctB64"
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decrypt(stored: string): string {
  const [ivB64, tagB64, ctB64] = stored.split(":");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("암호문 형식이 올바르지 않습니다.");
  const decipher = createDecipheriv("aes-256-gcm", encKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

// 숫자 외 문자 제거(하이픈·공백 등).
export function digitsOnly(v: string): string {
  return v.replace(/\D/g, "");
}

// HMAC-SHA256 블라인드 인덱스. 입력은 digitsOnly로 정규화해서 넣는다(정확일치 검색용).
export function blindIndex(normalized: string): string {
  return createHmac("sha256", bidxKey()).update(normalized).digest("base64");
}

// 번호 길이로 강사(13=주민)/업체(10=사업자) 판별. 그 외는 null.
export function derivePayeeType(bizNumberDigits: string): PayeeType | null {
  if (bizNumberDigits.length === 13) return "INSTRUCTOR";
  if (bizNumberDigits.length === 10) return "VENDOR";
  return null;
}

// 주민번호 900101-1****** / 사업자번호 123-45-6****
export function maskBizNumber(digits: string, type: PayeeType): string {
  if (type === "INSTRUCTOR") {
    return `${digits.slice(0, 6)}-${digits.slice(6, 7)}******`;
  }
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5, 6)}****`;
}

// 계좌번호: 뒤 4자리만 노출.
export function maskAccountNumber(digits: string): string {
  return `****${digits.slice(-4)}`;
}
```

- [ ] **Step 2: 테스트 작성**

Create `test/payee-secret.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  encrypt, decrypt, blindIndex, digitsOnly, derivePayeeType, maskBizNumber, maskAccountNumber,
} from "@/lib/crypto/payee-secret";

describe("payee-secret", () => {
  it("AES-GCM 암복호화 라운드트립", () => {
    expect(decrypt(encrypt("9001011234567"))).toBe("9001011234567");
  });
  it("같은 평문도 매번 다른 암호문(IV 랜덤)", () => {
    expect(encrypt("x")).not.toBe(encrypt("x"));
  });
  it("블라인드 인덱스는 결정적이고 값마다 다르다", () => {
    expect(blindIndex("1234567890")).toBe(blindIndex("1234567890"));
    expect(blindIndex("1234567890")).not.toBe(blindIndex("9999999999"));
  });
  it("번호 길이로 유형 판별", () => {
    expect(derivePayeeType("9001011234567")).toBe("INSTRUCTOR");
    expect(derivePayeeType("1234567890")).toBe("VENDOR");
    expect(derivePayeeType("123")).toBeNull();
  });
  it("마스킹·정규화 형식", () => {
    expect(maskBizNumber("9001011234567", "INSTRUCTOR")).toBe("900101-1******");
    expect(maskBizNumber("1234567890", "VENDOR")).toBe("123-45-6****");
    expect(maskAccountNumber("110123456789")).toBe("****6789");
    expect(digitsOnly("010-1234-5678")).toBe("01012345678");
  });
});
```

- [ ] **Step 3: 테스트 실행**

Run: `npx vitest run test/payee-secret.test.ts`
Expected: 5 tests PASS. (PAYEE_ENC_KEY/PAYEE_BIDX_KEY가 `.env.test`에 이미 있으므로 별도 설정 불필요. 실패 시 `.env.test`에 두 값이 base64 32바이트로 있는지 확인.)

- [ ] **Step 4: 커밋**

```bash
git add src/lib/crypto/payee-secret.ts test/payee-secret.test.ts
git commit -m "feat(payees): 민감정보 암호화·마스킹·블라인드 인덱스 모듈"
```

---

### Task 3: 라벨 + 검증 스키마 (`labels.ts`, `schemas.ts` 손 병합)

**Files:**
- Modify: `src/lib/labels.ts`
- Modify: `src/lib/validation/schemas.ts`
- Modify: `test/schemas.test.ts`

**Interfaces:**
- Produces: `TAX_TYPE_LABELS: readonly string[]`, `taxTypeLabel(t: TaxType): string`, `TAX_TYPE_BY_LABEL: Record<string, TaxType>`, `payeeTypeLabel(t: PayeeType): string` (labels.ts). `payeeUploadRowSchema: ZodObject` (schemas.ts) — Task 6(build-inputs)이 소비.

- [ ] **Step 1: `src/lib/labels.ts` 맨 끝(현재 38번째 줄, `expenseCategoryLabel` 함수 뒤)에 추가**

```typescript
import type { PayeeType, TaxType } from "@prisma/client";

export const TAX_TYPE_LABELS = [
  "세금계산서", "면세계산서", "현금영수증", "수기계산서", "사업소득", "기타소득",
] as const;

export function taxTypeLabel(t: TaxType): string {
  switch (t) {
    case "TAX_INVOICE": return "세금계산서";
    case "TAX_FREE_INVOICE": return "면세계산서";
    case "CASH_RECEIPT": return "현금영수증";
    case "HANDWRITTEN_INVOICE": return "수기계산서";
    case "BUSINESS_INCOME": return "사업소득";
    case "OTHER_INCOME": return "기타소득";
  }
}

export const TAX_TYPE_BY_LABEL: Record<(typeof TAX_TYPE_LABELS)[number], TaxType> = {
  "세금계산서": "TAX_INVOICE",
  "면세계산서": "TAX_FREE_INVOICE",
  "현금영수증": "CASH_RECEIPT",
  "수기계산서": "HANDWRITTEN_INVOICE",
  "사업소득": "BUSINESS_INCOME",
  "기타소득": "OTHER_INCOME",
};

export function payeeTypeLabel(t: PayeeType): string {
  return t === "INSTRUCTOR" ? "강사" : "업체";
}
```

`import type { PayeeType, TaxType } from "@prisma/client";`는 파일 맨 위(기존 `import type { AppRole } from "@/lib/auth/rbac";` 다음 줄)로 옮긴다.

- [ ] **Step 2: `src/lib/validation/schemas.ts`에 import 추가**

`import { CYCLE_VALUES } from "@/lib/clients/summary-view";` 다음 줄에 추가:

```typescript
import { TAX_TYPE_LABELS } from "@/lib/labels";
```

- [ ] **Step 3: 파일 맨 끝(현재 `export const depositSchema = billingSchema;` 뒤)에 추가**

```typescript
// 엑셀/CSV 한 행(문자열)을 검증. 번호는 숫자만 남겨 10/13자리인지 확인(업체/강사 판별 근거).
const bizNumberDigits = z.preprocess(
  (v) => (typeof v === "string" ? v.replace(/\D/g, "") : v),
  z.string().refine((s) => s.length === 10 || s.length === 13,
    "사업자번호(10자리) 또는 주민등록번호(13자리)여야 합니다."),
);

// 숫자만 남긴 길이로 자릿수 검증(하이픈·공백 허용).
const phoneField = z.string().refine(
  (s) => { const d = s.replace(/\D/g, ""); return d.length >= 9 && d.length <= 11; },
  "연락처는 숫자 9~11자리여야 합니다.",
);
const accountField = z.string().refine(
  (s) => { const d = s.replace(/\D/g, ""); return d.length >= 10 && d.length <= 16; },
  "계좌번호는 숫자 10~16자리여야 합니다.",
);

export const payeeUploadRowSchema = z.object({
  bizName: z.string().min(1, "이름은 필수입니다."),
  bizNumber: bizNumberDigits,
  phone: phoneField,
  bankName: z.string().min(1, "은행명은 필수입니다."),
  accountNumber: accountField,
  accountHolder: z.string().min(1, "예금주는 필수입니다."),
  taxType: z.enum(TAX_TYPE_LABELS),
});
```

- [ ] **Step 4: `test/schemas.test.ts` import에 `payeeUploadRowSchema` 추가**

`import { performanceBatchSchema, expenseSchema, billingSchema, taskSchema, clientSchema } from "@/lib/validation/schemas";`를 다음으로 교체:

```typescript
import {
  performanceBatchSchema,
  expenseSchema,
  billingSchema,
  taskSchema,
  clientSchema,
  payeeUploadRowSchema,
} from "@/lib/validation/schemas";
```

- [ ] **Step 5: `test/schemas.test.ts` 파일 맨 끝에 추가**

```typescript

describe("payeeUploadRowSchema", () => {
  const valid = {
    bizName: "홍길동", bizNumber: "900101-1234567", phone: "010-1234-5678",
    bankName: "국민", accountNumber: "110-123-456789", accountHolder: "홍길동", taxType: "사업소득",
  };
  it("유효 행은 번호를 숫자만 남겨 통과", () => {
    const r = payeeUploadRowSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.bizNumber).toBe("9001011234567");
  });
  it("번호 자릿수가 10/13이 아니면 실패", () => {
    expect(payeeUploadRowSchema.safeParse({ ...valid, bizNumber: "123" }).success).toBe(false);
  });
  it("알 수 없는 청구방식은 실패", () => {
    expect(payeeUploadRowSchema.safeParse({ ...valid, taxType: "카드" }).success).toBe(false);
  });
  it("필수 항목 누락은 실패", () => {
    expect(payeeUploadRowSchema.safeParse({ ...valid, accountHolder: "" }).success).toBe(false);
  });
});

describe("payeeUploadRowSchema 자릿수", () => {
  const base = { bizName: "이름", bizNumber: "1234567890", bankName: "국민", accountHolder: "대표", taxType: "세금계산서" as const };
  it("전화 8자리는 실패, 9자리는 통과", () => {
    expect(payeeUploadRowSchema.safeParse({ ...base, phone: "02-123-45", accountNumber: "1101234567" }).success).toBe(false);
    expect(payeeUploadRowSchema.safeParse({ ...base, phone: "021234567", accountNumber: "1101234567" }).success).toBe(true);
  });
  it("계좌 9자리는 실패, 10자리는 통과", () => {
    expect(payeeUploadRowSchema.safeParse({ ...base, phone: "01012345678", accountNumber: "123456789" }).success).toBe(false);
    expect(payeeUploadRowSchema.safeParse({ ...base, phone: "01012345678", accountNumber: "1234567890" }).success).toBe(true);
  });
});
```

- [ ] **Step 6: 테스트 실행**

Run: `npx vitest run test/schemas.test.ts`
Expected: 기존 테스트 전부 + 신규 6개 PASS.

- [ ] **Step 7: 커밋**

```bash
git add src/lib/labels.ts src/lib/validation/schemas.ts test/schemas.test.ts
git commit -m "feat(payees): 청구방식 라벨 + 업로드 행 검증 스키마"
```

---

### Task 4: 데이터 계층(`src/lib/data/payees.ts`)

**Files:**
- Create: `src/lib/data/payees.ts`
- Test: `test/data-payees.test.ts`

**Interfaces:**
- Consumes: `withRLS`, `RlsContext`(`@/lib/rls`), `decrypt/encrypt/blindIndex/digitsOnly`(`@/lib/crypto/payee-secret`, Task 2), Prisma 모델 `Payee`(Task 1).
- Produces: `type PayeeCreateInput`, `type PayeeRow`, `createPayeesBulk(ctx, inputs: PayeeCreateInput[]): Promise<{created:number; skipped:number}>`, `listPayees(ctx): Promise<PayeeRow[]>`, `findPayeeByBizNumber(ctx, bizNumberPlain: string): Promise<Payee[]>`.

- [ ] **Step 1: 파일 생성**

Create `src/lib/data/payees.ts`:

```typescript
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

// 지급 리스트 화면용(ADMIN·SETTLEMENT 전용) — 원문 복호화 + 첨부 존재 배지.
export type PayeeRow = {
  id: string;
  keyId: string;
  payeeType: PayeeType;
  bizName: string;
  bizNumber: string; // 복호화 원문
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
      bizNumber: decrypt(r.bizNumberEnc),
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
```

- [ ] **Step 2: 테스트 작성**

Create `test/data-payees.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { withRLS } from "@/lib/rls";
import {
  createPayeesBulk, listPayees, findPayeeByBizNumber, type PayeeCreateInput,
} from "@/lib/data/payees";
import {
  encrypt, blindIndex, maskBizNumber, maskAccountNumber,
} from "@/lib/crypto/payee-secret";

const ADMIN = { userId: "seed-admin", role: "ADMIN" as const };

async function reset() {
  await withRLS(ADMIN, async (tx) => {
    await tx.payeeAttachment.deleteMany();
    await tx.payee.deleteMany();
    await tx.$executeRawUnsafe('ALTER SEQUENCE "payee_key_seq_instructor" RESTART WITH 1');
    await tx.$executeRawUnsafe('ALTER SEQUENCE "payee_key_seq_vendor" RESTART WITH 1');
  });
}

function input(bizDigits: string, type: "INSTRUCTOR" | "VENDOR"): PayeeCreateInput {
  const acct = "110123456789";
  return {
    payeeType: type,
    bizName: "이름",
    bizNumberEnc: encrypt(bizDigits),
    bizNumberMasked: maskBizNumber(bizDigits, type),
    bizNumberBidx: blindIndex(bizDigits),
    phone: "010-1234-5678",
    phoneNormalized: "01012345678",
    bankName: "국민",
    accountNumberEnc: encrypt(acct),
    accountNumberMasked: maskAccountNumber(acct),
    accountHolder: "예금주",
    taxType: type === "INSTRUCTOR" ? "BUSINESS_INCOME" : "TAX_INVOICE",
  };
}

describe("payees 데이터 계층", () => {
  beforeEach(reset);

  it("강사=a###, 업체=b### 로 유형별 채번", async () => {
    await createPayeesBulk(ADMIN, [
      input("9001011234567", "INSTRUCTOR"),
      input("1234567890", "VENDOR"),
      input("9002022345678", "INSTRUCTOR"),
    ]);
    const rows = await listPayees(ADMIN);
    expect(rows.map((r) => r.keyId).sort()).toEqual(["a001", "a002", "b001"]);
  });

  it("listPayees는 원문을 복호화해 반환", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    const [row] = await listPayees(ADMIN);
    expect(row.bizNumber).toBe("1234567890");
    expect(row.accountNumber).toBe("110123456789");
    expect(row.hasBizCert).toBe(false);
    expect(row.hasBankbook).toBe(false);
  });

  it("findPayeeByBizNumber는 블라인드 인덱스로 정확일치(하이픈 무관)", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    const found = await findPayeeByBizNumber(ADMIN, "123-45-67890");
    expect(found).toHaveLength(1);
  });

  it("기존 DB·파일 내 중복(bizNumberBidx)은 스킵하고 신규만 등록", async () => {
    const r1 = await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    expect(r1).toEqual({ created: 1, skipped: 0 });

    // 같은 번호(DB중복) + 파일내 중복(9002...×2) + 신규 1건(9003...)
    const r2 = await createPayeesBulk(ADMIN, [
      input("1234567890", "VENDOR"),      // DB 중복 → skip
      input("9002022345678", "INSTRUCTOR"),
      input("9002022345678", "INSTRUCTOR"), // 파일내 중복 → skip
      input("9003033456789", "INSTRUCTOR"),
    ]);
    expect(r2).toEqual({ created: 2, skipped: 2 });

    const rows = await listPayees(ADMIN);
    expect(rows).toHaveLength(3); // b001, a001, a002
  });

  it("listPayees는 마스킹 값을 함께 반환", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    const [row] = await listPayees(ADMIN);
    expect(row.bizNumberMasked).toBe("123-45-6****");
  });

  it("같은 bizNumberBidx는 DB unique 제약으로 직접 중복 insert가 거부된다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    await expect(
      withRLS(ADMIN, (tx) => tx.payee.create({ data: { keyId: "b999", ...input("1234567890", "VENDOR") } })),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: 테스트 실행**

Run: `npx vitest run test/data-payees.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 4: 커밋**

```bash
git add src/lib/data/payees.ts test/data-payees.test.ts
git commit -m "feat(payees): 데이터 계층(채번·복호화 목록·블라인드 검색)"
```

---

### Task 5: 파싱 유틸(`csv.ts` 확장, `xlsx.ts`) + `exceljs` 의존성

**Files:**
- Modify: `src/lib/csv.ts`
- Modify: `test/csv.test.ts`
- Create: `src/app/(app)/expenses/payees/xlsx.ts`
- Test: `test/payee-xlsx.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `parseCsv(text: string): string[][]` (csv.ts에 추가, 기존 `csvFromRows`는 변경 없음). `TEMPLATE_HEADERS: readonly string[]`, `parseXlsxToRows(buf: Buffer|ArrayBuffer): Promise<string[][]>`, `buildTemplateXlsxBuffer(): Promise<Buffer>` (xlsx.ts, 신규).

- [ ] **Step 1: `package.json`에 `exceljs` 의존성 추가**

`"dependencies"` 블록의 `"@prisma/client": "^6.19.3",` 다음 줄에 추가:

```json
    "exceljs": "^4.4.0",
```

Run: `npm install`
Expected: `package-lock.json` 갱신, `node_modules/exceljs` 설치됨.

- [ ] **Step 2: `src/lib/csv.ts` 맨 끝에 `parseCsv` 추가**

기존 `escapeCell`/`csvFromRows`는 그대로 두고 파일 끝에 추가:

```typescript

// 간단 CSV 파서: 따옴표("")·콤마 구분·CRLF/LF·선행 BOM 처리. 2차원 배열 반환.
export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM 제거
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      cell += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { row.push(cell); cell = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; continue; }
    cell += c; i++;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}
```

- [ ] **Step 3: `test/csv.test.ts`에 `parseCsv` import 추가 및 테스트 추가**

`import { csvFromRows } from "@/lib/csv";`를 `import { csvFromRows, parseCsv } from "@/lib/csv";`로 교체하고, 파일 끝에 추가:

```typescript

describe("parseCsv", () => {
  it("헤더+행을 2차원 배열로 파싱", () => {
    expect(parseCsv("이름,연락처\r\n홍길동,01012345678")).toEqual([
      ["이름", "연락처"],
      ["홍길동", "01012345678"],
    ]);
  });
  it("따옴표로 감싼 셀의 콤마/따옴표 이스케이프 처리", () => {
    expect(parseCsv('"a,b","he said ""hi"""')).toEqual([["a,b", 'he said "hi"']]);
  });
  it("BOM과 LF 줄바꿈, 빈 입력 처리", () => {
    expect(parseCsv("﻿x\ny")).toEqual([["x"], ["y"]]);
    expect(parseCsv("")).toEqual([]);
  });
});
```

- [ ] **Step 4: `src/app/(app)/expenses/payees/xlsx.ts` 생성**

Create `src/app/(app)/expenses/payees/xlsx.ts`:

```typescript
import ExcelJS from "exceljs";

// 서식·업로드 공통 컬럼 순서. keyId는 자동 채번이라 서식에 없음.
export const TEMPLATE_HEADERS = [
  "사업자명(이름)", "사업자번호(주민등록번호)", "연락처", "은행명", "계좌번호", "예금주", "청구방식",
] as const;

// 첫 워크시트를 문자열 2차원 배열로 변환(헤더 컬럼 수만큼 정렬 유지, 셀은 표시 텍스트).
export async function parseXlsxToRows(buf: Buffer | ArrayBuffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  // exceljs 타입 정의가 로컬 Buffer(ArrayBuffer 확장)를 선언해 전역 Node Buffer와 어긋난다 — unknown 경유로 우회.
  await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const colCount = ws.columnCount;
  const rows: string[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= colCount; c++) {
      cells.push((row.getCell(c).text ?? "").toString());
    }
    rows.push(cells);
  }
  return rows;
}

// 헤더 한 행만 있는 서식 워크북 버퍼.
export async function buildTemplateXlsxBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("지급리스트");
  ws.addRow([...TEMPLATE_HEADERS]);
  // 사업자번호·계좌번호 등 숫자 문자열의 선행 0/자릿수 손실 방지 — 데이터 컬럼을 텍스트 서식으로.
  for (let c = 1; c <= TEMPLATE_HEADERS.length; c++) {
    ws.getColumn(c).numFmt = "@";
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
```

- [ ] **Step 5: 테스트 작성**

Create `test/payee-xlsx.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseXlsxToRows, buildTemplateXlsxBuffer, TEMPLATE_HEADERS } from "@/app/(app)/expenses/payees/xlsx";

describe("payee xlsx 유틸", () => {
  it("서식 버퍼는 헤더 한 행으로 라운드트립된다", async () => {
    const buf = await buildTemplateXlsxBuffer();
    const rows = await parseXlsxToRows(buf);
    expect(rows[0]).toEqual([...TEMPLATE_HEADERS]);
    expect(rows).toHaveLength(1);
  });

  it("데이터 행을 문자열 2차원 배열로 읽는다(컬럼 정렬 유지)", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("s");
    ws.addRow([...TEMPLATE_HEADERS]);
    ws.addRow(["테스트업체", "123-45-67890", "010-1234-5678", "국민", "1101234567", "대표", "세금계산서"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const rows = await parseXlsxToRows(buf);
    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toBe("테스트업체");
    expect(rows[1][6]).toBe("세금계산서");
  });

  it("서버액션의 file.arrayBuffer() 경로처럼 실제 ArrayBuffer 입력도 파싱한다", async () => {
    const buf = await buildTemplateXlsxBuffer();
    // Buffer가 아닌 순수 ArrayBuffer로 슬라이스 — 프로덕션에서 file.arrayBuffer()가 반환하는 타입과 동일.
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    expect(ab instanceof ArrayBuffer).toBe(true);
    const rows = await parseXlsxToRows(ab);
    expect(rows[0]).toEqual([...TEMPLATE_HEADERS]);
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 6: 테스트 실행**

Run: `npx vitest run test/csv.test.ts test/payee-xlsx.test.ts`
Expected: csv.test.ts 6개(기존 3 + 신규 3) + payee-xlsx.test.ts 3개, 총 9 tests PASS.

- [ ] **Step 7: 커밋**

```bash
git add package.json package-lock.json src/lib/csv.ts test/csv.test.ts "src/app/(app)/expenses/payees/xlsx.ts" test/payee-xlsx.test.ts
git commit -m "feat(payees): CSV/엑셀 파싱 유틸 + exceljs 의존성"
```

---

### Task 6: 업로드 행 → 입력 빌더(`build-inputs.ts`)

**Files:**
- Create: `src/app/(app)/expenses/payees/build-inputs.ts`
- Test: `test/payee-build-inputs.test.ts`

**Interfaces:**
- Consumes: `parseCsv`(Task 5), `payeeUploadRowSchema`(Task 3), `TAX_TYPE_BY_LABEL`(Task 3), `encrypt/blindIndex/digitsOnly/derivePayeeType/maskBizNumber/maskAccountNumber`(Task 2), `type PayeeCreateInput`(Task 4).
- Produces: `type BuildResult = { inputs: PayeeCreateInput[]; errors: {row:number; message:string}[] }`, `buildPayeeInputsFromRows(rows: string[][]): BuildResult`, `buildPayeeInputsFromCsv(csvText: string): BuildResult`.

- [ ] **Step 1: 파일 생성**

Create `src/app/(app)/expenses/payees/build-inputs.ts`:

```typescript
import { parseCsv } from "@/lib/csv";
import { payeeUploadRowSchema } from "@/lib/validation/schemas";
import { TAX_TYPE_BY_LABEL } from "@/lib/labels";
import {
  encrypt, blindIndex, digitsOnly, derivePayeeType, maskBizNumber, maskAccountNumber,
} from "@/lib/crypto/payee-secret";
import type { PayeeCreateInput } from "@/lib/data/payees";

// 필드 → 허용 헤더명(별칭). 기존 CSV 라벨과 신규 엑셀 서식 라벨을 모두 인식.
const HEADER_ALIASES: Record<string, string[]> = {
  이름: ["이름", "사업자명(이름)"],
  사업자번호: ["사업자번호", "사업자번호(주민등록번호)"],
  연락처: ["연락처"],
  은행: ["은행", "은행명"],
  계좌번호: ["계좌번호"],
  예금주: ["예금주"],
  청구방식: ["청구방식"],
};

export type BuildResult = {
  inputs: PayeeCreateInput[];
  errors: { row: number; message: string }[];
};

// CSV·엑셀 공통 코어: 첫 행을 헤더로 보고 별칭 매핑 후 행별 검증·암호화.
export function buildPayeeInputsFromRows(rows: string[][]): BuildResult {
  const inputs: PayeeCreateInput[] = [];
  const errors: BuildResult["errors"] = [];

  if (rows.length === 0) return { inputs, errors: [{ row: 0, message: "빈 파일입니다." }] };

  const header = rows[0].map((h) => h.trim());
  const colIndex: Record<string, number> = {};
  const missing: string[] = [];
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = header.findIndex((h) => aliases.includes(h));
    if (idx === -1) missing.push(field);
    else colIndex[field] = idx;
  }
  if (missing.length > 0) {
    return { inputs, errors: [{ row: 0, message: `헤더 누락: ${missing.join(", ")}` }] };
  }
  const at = (cells: string[], field: string) => (cells[colIndex[field]] ?? "").trim();

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (cells.every((c) => (c ?? "").trim() === "")) continue; // 빈 행 skip

    const parsed = payeeUploadRowSchema.safeParse({
      bizName: at(cells, "이름"),
      bizNumber: at(cells, "사업자번호"),
      phone: at(cells, "연락처"),
      bankName: at(cells, "은행"),
      accountNumber: at(cells, "계좌번호"),
      accountHolder: at(cells, "예금주"),
      taxType: at(cells, "청구방식"),
    });
    if (!parsed.success) {
      errors.push({ row: r + 1, message: parsed.error.issues[0]?.message ?? "형식 오류" });
      continue;
    }

    const d = parsed.data;
    const type = derivePayeeType(d.bizNumber)!; // 스키마가 10/13자리를 보장
    const acctDigits = digitsOnly(d.accountNumber);
    inputs.push({
      payeeType: type,
      bizName: d.bizName,
      bizNumberEnc: encrypt(d.bizNumber),
      bizNumberMasked: maskBizNumber(d.bizNumber, type),
      bizNumberBidx: blindIndex(d.bizNumber),
      phone: d.phone,
      phoneNormalized: digitsOnly(d.phone),
      bankName: d.bankName,
      accountNumberEnc: encrypt(acctDigits),
      accountNumberMasked: maskAccountNumber(acctDigits),
      accountHolder: d.accountHolder,
      taxType: TAX_TYPE_BY_LABEL[d.taxType],
    });
  }
  return { inputs, errors };
}

// CSV 진입점 — 파싱 후 공통 코어 재사용.
export function buildPayeeInputsFromCsv(csvText: string): BuildResult {
  return buildPayeeInputsFromRows(parseCsv(csvText));
}
```

- [ ] **Step 2: 테스트 작성**

Create `test/payee-build-inputs.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildPayeeInputsFromCsv, buildPayeeInputsFromRows } from "@/app/(app)/expenses/payees/build-inputs";
import { decrypt } from "@/lib/crypto/payee-secret";

const HEADER = "이름,사업자번호,연락처,은행,계좌번호,예금주,청구방식";

describe("buildPayeeInputsFromCsv", () => {
  it("업체(10자리)·강사(13자리)를 판별하고 암호화·마스킹·유형을 채운다", () => {
    const csv = [
      HEADER,
      "테스트업체,123-45-67890,010-1111-2222,국민,110-123-456789,대표,세금계산서",
      "김강사,900101-1234567,010-3333-4444,신한,220-1234567890,김강사,사업소득",
    ].join("\r\n");
    const { inputs, errors } = buildPayeeInputsFromCsv(csv);
    expect(errors).toEqual([]);
    expect(inputs).toHaveLength(2);
    expect(inputs[0].payeeType).toBe("VENDOR");
    expect(inputs[0].taxType).toBe("TAX_INVOICE");
    expect(inputs[0].bizNumberMasked).toBe("123-45-6****");
    expect(decrypt(inputs[0].bizNumberEnc)).toBe("1234567890");
    expect(inputs[1].payeeType).toBe("INSTRUCTOR");
    expect(inputs[1].bizNumberMasked).toBe("900101-1******");
  });

  it("형식 오류 행은 errors에 행번호와 함께 수집하고 건너뛴다", () => {
    const csv = [HEADER, "불량,123,010-1,국민,110,대표,세금계산서"].join("\r\n");
    const { inputs, errors } = buildPayeeInputsFromCsv(csv);
    expect(inputs).toHaveLength(0);
    expect(errors[0].row).toBe(2);
  });

  it("헤더 누락은 단일 에러로 반환", () => {
    const { inputs, errors } = buildPayeeInputsFromCsv("이름,연락처\n홍길동,010");
    expect(inputs).toHaveLength(0);
    expect(errors[0].message).toMatch(/헤더 누락/);
  });

  it("빈 데이터 행은 조용히 건너뛴다", () => {
    const csv = [HEADER, ",,,,,,", "테스트업체,123-45-67890,010-1234-5678,국민,1101234567,대표,세금계산서"].join("\n");
    const { inputs, errors } = buildPayeeInputsFromCsv(csv);
    expect(errors).toEqual([]);
    expect(inputs).toHaveLength(1);
  });
});

describe("buildPayeeInputsFromRows 헤더 별칭", () => {
  it("서식 라벨(사업자명(이름)/은행명/사업자번호(주민등록번호))을 인식한다", () => {
    const rows = [
      ["사업자명(이름)", "사업자번호(주민등록번호)", "연락처", "은행명", "계좌번호", "예금주", "청구방식"],
      ["테스트업체", "123-45-67890", "010-1234-5678", "국민은행", "1101234567", "대표", "세금계산서"],
    ];
    const { inputs, errors } = buildPayeeInputsFromRows(rows);
    expect(errors).toEqual([]);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].bankName).toBe("국민은행");
  });
});
```

- [ ] **Step 3: 테스트 실행**

Run: `npx vitest run test/payee-build-inputs.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 4: 커밋**

```bash
git add "src/app/(app)/expenses/payees/build-inputs.ts" test/payee-build-inputs.test.ts
git commit -m "feat(payees): 엑셀/CSV 행 → 입력 빌더(판별·암호화·오류수집)"
```

---

### Task 7: 업로드 서버액션 + 서식 다운로드 라우트

**Files:**
- Create: `src/app/(app)/expenses/payees/upload-state.ts`
- Create: `src/app/(app)/expenses/payees/actions.ts`
- Create: `src/app/(app)/expenses/payees/template/route.ts`

**Interfaces:**
- Consumes: `requireRole`(`@/lib/auth/session`), `getRlsContext`(`@/lib/context`), `createPayeesBulk`(Task 4), `buildPayeeInputsFromCsv/buildPayeeInputsFromRows`(Task 6), `parseXlsxToRows/buildTemplateXlsxBuffer`(Task 5), `ActionState`(`@/lib/action-state`).
- Produces: `type PayeeUploadState`, `PAYEE_UPLOAD_INIT`, `uploadPayeesAction(prev, formData): Promise<PayeeUploadState>` — Task 9(PayeeUploadModal)가 소비. `GET /expenses/payees/template` 라우트.

- [ ] **Step 1: 업로드 상태 타입 생성**

Create `src/app/(app)/expenses/payees/upload-state.ts`:

```typescript
import type { ActionState } from "@/lib/action-state";

// 업로드 결과 상태(모달의 useActionState용). "use server" 파일(actions.ts)은 함수만 export할 수 있어
// 상수/타입은 여기 일반 모듈에 둔다.
export type PayeeUploadState = ActionState & {
  created?: number;
  skipped?: number;
  rowErrors?: { row: number; message: string }[];
};

export const PAYEE_UPLOAD_INIT: PayeeUploadState = { ok: true };
```

- [ ] **Step 2: 서버액션 생성**

Create `src/app/(app)/expenses/payees/actions.ts`:

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { createPayeesBulk } from "@/lib/data/payees";
import { buildPayeeInputsFromCsv, buildPayeeInputsFromRows, type BuildResult } from "./build-inputs";
import { parseXlsxToRows } from "./xlsx";
import type { PayeeUploadState } from "./upload-state";

export async function uploadPayeesAction(
  _prev: PayeeUploadState,
  formData: FormData,
): Promise<PayeeUploadState> {
  const user = await requireRole("SETTLEMENT"); // ADMIN도 랭크상 통과
  const ctx = getRlsContext(user);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "파일을 선택하세요." };
  }

  const name = file.name.toLowerCase();
  let build: BuildResult;
  try {
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      build = buildPayeeInputsFromRows(await parseXlsxToRows(await file.arrayBuffer()));
    } else if (name.endsWith(".csv")) {
      build = buildPayeeInputsFromCsv(await file.text());
    } else {
      return { ok: false, error: "지원하지 않는 형식입니다 (.xlsx, .xls, .csv)." };
    }
  } catch {
    return { ok: false, error: "파일을 읽을 수 없습니다. 양식을 확인하세요." };
  }

  const { inputs, errors } = build;
  if (inputs.length === 0) {
    return {
      ok: false,
      error: errors.length ? "등록할 유효한 행이 없습니다." : "등록할 데이터가 없습니다.",
      rowErrors: errors,
    };
  }

  const { created, skipped } = await createPayeesBulk(ctx, inputs);
  revalidatePath("/expenses");

  const parts = [`${created}건 등록`];
  if (skipped) parts.push(`${skipped}건 중복 스킵`);
  return { ok: true, message: parts.join(" · "), created, skipped, rowErrors: errors };
}
```

- [ ] **Step 3: 서식 다운로드 라우트 생성**

Create `src/app/(app)/expenses/payees/template/route.ts`:

```typescript
import { requireRole } from "@/lib/auth/session";
import { buildTemplateXlsxBuffer } from "../xlsx";

export const runtime = "nodejs";

// 지급 리스트 등록용 빈 서식(.xlsx, 헤더만) 다운로드. ADMIN·SETTLEMENT 전용.
export async function GET() {
  await requireRole("SETTLEMENT");
  const buf = await buildTemplateXlsxBuffer();
  const filename = encodeURIComponent("지급리스트_양식.xlsx");
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
```

- [ ] **Step 4: 타입 체크로 컴파일 검증(런타임 테스트는 Task 9 UI 완성 후 수동 확인)**

Run: `npx tsc --noEmit`
Expected: `src/app/(app)/expenses/payees/{actions,template/route}.ts` 관련 에러 없음.

- [ ] **Step 5: 커밋**

```bash
git add "src/app/(app)/expenses/payees/upload-state.ts" "src/app/(app)/expenses/payees/actions.ts" "src/app/(app)/expenses/payees/template"
git commit -m "feat(payees): 업로드 서버액션 + 서식 다운로드 라우트"
```

---

### Task 8: 재사용 드래그앤드롭 컴포넌트(`FileDropzone`)

**Files:**
- Create: `src/components/FileDropzone.tsx`

**Interfaces:**
- Produces: `FileDropzone({ name, accept, hint?, label?, onFileName? }): JSX.Element` — Task 9(PayeeUploadModal)가 소비.

- [ ] **Step 1: 파일 생성**

Create `src/components/FileDropzone.tsx`:

```typescript
"use client";

import { useRef, useState } from "react";

// 재사용 드래그 앤 드롭 파일 선택기. 내부 hidden input이 폼 필드(name)이며,
// 드롭 시 input.files에 반영해 네이티브 폼 제출과 호환된다.
type Props = {
  name: string;
  accept: string;
  hint?: string;
  label?: string;
  onFileName?: (name: string | null) => void;
};

export function FileDropzone({ name, accept, hint, label = "엑셀 파일을 이곳에 드래그 앤 드롭 하세요", onFileName }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  function update(files: FileList | null) {
    const f = files && files.length ? files[0] : null;
    setFileName(f ? f.name : null);
    onFileName?.(f ? f.name : null);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const files = e.dataTransfer.files;
    if (inputRef.current && files.length) {
      inputRef.current.files = files; // 폼 제출 소스로 반영
      update(files);
    }
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`flex flex-col items-center justify-center gap-2 rounded-[14px] border-2 border-dashed px-6 py-10 text-center ${
        dragging ? "border-[var(--color-primary)] bg-[var(--color-hover)]" : "border-[var(--color-border)]"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        name={name}
        accept={accept}
        className="hidden"
        onChange={(e) => update(e.target.files)}
      />
      <div className="text-3xl" aria-hidden>☁️</div>
      <p className="text-sm font-medium">{label}</p>
      {hint && <p className="text-xs text-[var(--color-muted)]">{hint}</p>}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="mt-1 rounded border border-[var(--color-border)] px-4 py-2 text-sm"
      >
        📁 파일 선택
      </button>
      {fileName && <p className="mt-1 text-xs text-[var(--color-primary)]">{fileName}</p>}
    </div>
  );
}
```

- [ ] **Step 2: 컴파일 확인**

Run: `npx tsc --noEmit`
Expected: `src/components/FileDropzone.tsx` 관련 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add src/components/FileDropzone.tsx
git commit -m "feat(components): 재사용 파일 드래그앤드롭 컴포넌트"
```

---

### Task 9: 지급 리스트 UI(`PayeeListPanel`, `PayeeUploadModal`)

**Files:**
- Create: `src/app/(app)/expenses/PayeeUploadModal.tsx`
- Create: `src/app/(app)/expenses/PayeeListPanel.tsx`

**Interfaces:**
- Consumes: `FileDropzone`(Task 8), `uploadPayeesAction`(Task 7), `PAYEE_UPLOAD_INIT`(Task 7), `type PayeeRow`(Task 4), `taxTypeLabel`(Task 3).
- Produces: `PayeeUploadModal({open, onClose}): JSX.Element`, `PayeeListPanel({rows: PayeeRow[]}): JSX.Element` — Task 10(page.tsx)이 소비.

- [ ] **Step 1: 업로드 모달 생성**

Create `src/app/(app)/expenses/PayeeUploadModal.tsx`:

```typescript
"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { FileDropzone } from "@/components/FileDropzone";
import { uploadPayeesAction } from "./payees/actions";
import { PAYEE_UPLOAD_INIT } from "./payees/upload-state";

export function PayeeUploadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(uploadPayeesAction, PAYEE_UPLOAD_INIT);

  // 등록이 1건이라도 생기면 목록 갱신, 오류 없이 성공하면 모달 닫기.
  useEffect(() => {
    if (state.created && state.created > 0) router.refresh();
    if (state.ok && state.created && state.created > 0 && !(state.rowErrors && state.rowErrors.length)) {
      onClose();
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-[14px] bg-[var(--color-surface)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold">📗 지출 입력 - 지급 리스트 등록</h2>
          <button type="button" onClick={onClose} className="text-[var(--color-muted)]" aria-label="닫기">✕</button>
        </div>
        <p className="mb-4 text-sm text-[var(--color-muted)]">
          강사 및 업체 지급 정보를 엑셀 양식에 맞춰 일괄 업로드합니다.
        </p>

        <form action={formAction}>
          <FileDropzone name="file" accept=".xlsx,.xls,.csv" hint="지원 확장자: .xlsx, .xls, .csv" />

          <p className="mt-3 rounded bg-[var(--color-hover)] px-3 py-2 text-xs text-[var(--color-muted)]">
            업로드 항목: 사업자명(이름), 사업자번호, 연락처, 은행명, 계좌번호, 예금주, 청구방식
          </p>

          {state.ok && state.message && (
            <p className="mt-3 text-sm text-[var(--color-primary)]">{state.message}</p>
          )}
          {!state.ok && state.error && (
            <p className="mt-3 text-sm text-[var(--color-danger)]">{state.error}</p>
          )}
          {state.rowErrors && state.rowErrors.length > 0 && (
            <ul className="mt-2 max-h-40 list-disc overflow-y-auto rounded border border-[var(--color-border)] px-5 py-2 text-xs text-[var(--color-danger)]">
              {state.rowErrors.map((e, i) => (
                <li key={i}>{e.row ? `${e.row}행: ` : ""}{e.message}</li>
              ))}
            </ul>
          )}

          <div className="mt-5 flex items-center justify-between">
            <a
              href="/expenses/payees/template"
              className="rounded border border-[var(--color-border)] px-4 py-2 text-sm"
            >
              ⬇ 엑셀 서식 다운로드
            </a>
            <button
              type="submit"
              disabled={pending}
              className="rounded bg-[var(--color-primary)] px-5 py-2 text-sm text-white disabled:opacity-60"
            >
              {pending ? "업로드 중..." : "⬆ 업로드 실행"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 목록 패널 생성**

Create `src/app/(app)/expenses/PayeeListPanel.tsx`:

```typescript
"use client";

import { useState } from "react";
import { taxTypeLabel } from "@/lib/labels";
import type { TaxType } from "@prisma/client";
import type { PayeeRow } from "@/lib/data/payees";
import { PayeeUploadModal } from "./PayeeUploadModal";

// 검색 드롭다운 옵션(다음 단계에서 검색 로직 연결).
const SEARCH_FIELDS = ["사업자명(이름)", "사업자번호", "고유번호"] as const;

// 은행명 편집용 드롭다운 옵션.
const BANKS = ["국민은행", "신한은행", "하나은행", "우리은행", "농협은행", "기업은행", "카카오뱅크", "토스뱅크"] as const;

// 청구방식별 뱃지 색 — 스키마 TaxType 6종 전체. 시안 미포함(현금영수증/수기계산서)도 정의.
const TAX_BADGE_CLASS: Record<TaxType, string> = {
  TAX_INVOICE: "bg-blue-100 text-blue-700",
  TAX_FREE_INVOICE: "bg-green-100 text-green-700",
  BUSINESS_INCOME: "bg-amber-100 text-amber-700",
  OTHER_INCOME: "bg-gray-100 text-gray-600",
  CASH_RECEIPT: "bg-teal-100 text-teal-700",
  HANDWRITTEN_INVOICE: "bg-purple-100 text-purple-700",
};

function TaxBadge({ taxType }: { taxType: TaxType }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${TAX_BADGE_CLASS[taxType]}`}>
      {taxTypeLabel(taxType)}
    </span>
  );
}

function AttachmentCell({ hasAttachment }: { hasAttachment: boolean }) {
  if (hasAttachment) {
    return (
      <button type="button" className="whitespace-nowrap text-sm text-[var(--color-primary)] hover:underline">
        📎 첨부파일
      </button>
    );
  }
  return (
    <span className="inline-block whitespace-nowrap rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-[var(--color-danger)]">
      ⚠ 미첨부
    </span>
  );
}

const inputCls =
  "w-full rounded border border-[var(--color-border)] px-2 py-1.5 text-center text-sm focus:border-[var(--color-primary)] focus:outline-none";
// 모든 셀 공통: 가운데 정렬 + 세로 가운데 + 줄바꿈 방지(편집 시 글자가 아래로 내려가지 않게).
const cellCls = "whitespace-nowrap px-3 py-2 text-center align-middle";

export function PayeeListPanel({ rows }: { rows: PayeeRow[] }) {
  // 체크박스 선택 행(선택만 — 편집과 무관). 다음 단계에서 일괄 작업 연결.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 편집 모드 행(관리 연필 아이콘으로 진입).
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const [uploadOpen, setUploadOpen] = useState(false);

  const allSelected = rows.length > 0 && selected.size === rows.length;

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }

  function startEditing(id: string) {
    setEditing((prev) => new Set(prev).add(id));
  }

  function stopEditing(id: string) {
    setEditing((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  return (
    <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      {/* 상단 바: 좌측 검색 / 우측 액션. 로직은 다음 단계. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-[var(--color-muted)]">검색:</span>
          <select className="rounded border border-[var(--color-border)] px-3 py-2 text-sm">
            {SEARCH_FIELDS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="검색어 입력 (하이픈 제외 가능)"
            className="w-64 rounded border border-[var(--color-border)] px-3 py-2 text-sm"
          />
          <button type="button" className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white">
            🔍 조회
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">
            📗 엑셀 다운로드
          </button>
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            className="rounded bg-[var(--color-success)] px-4 py-2 text-sm text-white"
          >
            + 등록
          </button>
        </div>
      </div>

      {/* 목록 테이블 — 헤더/내용 모두 가운데 정렬 */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-center text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[var(--color-muted)]">
              <th className="w-10 whitespace-nowrap px-3 py-2 align-middle">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} aria-label="전체선택" />
              </th>
              <th className="whitespace-nowrap px-3 py-2">고유번호</th>
              <th className="whitespace-nowrap px-3 py-2">사업자명(이름)</th>
              <th className="whitespace-nowrap px-3 py-2">사업자번호(주민등록번호)</th>
              <th className="whitespace-nowrap px-3 py-2">은행명</th>
              <th className="whitespace-nowrap px-3 py-2">계좌번호</th>
              <th className="whitespace-nowrap px-3 py-2">예금주</th>
              <th className="whitespace-nowrap px-3 py-2">청구방식</th>
              <th className="whitespace-nowrap px-3 py-2">첨부파일</th>
              <th className="whitespace-nowrap px-3 py-2">관리</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isEditing = editing.has(r.id);
              const isSelected = selected.has(r.id);
              return (
                <tr
                  key={r.id}
                  className={`border-b border-[var(--color-border)] ${isEditing || isSelected ? "bg-[var(--color-hover)]" : ""}`}
                >
                  <td className={cellCls}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(r.id)}
                      aria-label={`${r.bizName} 선택`}
                    />
                  </td>
                  <td className={`${cellCls} font-medium text-[var(--color-primary)]`}>{r.keyId}</td>

                  {/* 사업자명 */}
                  <td className={cellCls}>
                    {isEditing ? <input className={inputCls} defaultValue={r.bizName} /> : r.bizName}
                  </td>

                  {/* 사업자번호(마스킹) — 민감정보, 편집 모드에서도 읽기 전용 */}
                  <td className={`${cellCls} text-[var(--color-muted)]`}>{r.bizNumberMasked}</td>

                  {/* 은행명(드롭다운) */}
                  <td className={cellCls}>
                    {isEditing ? (
                      <select className={inputCls} defaultValue={r.bankName}>
                        {BANKS.map((b) => (
                          <option key={b} value={b}>{b}</option>
                        ))}
                      </select>
                    ) : (
                      r.bankName
                    )}
                  </td>

                  {/* 계좌번호 */}
                  <td className={cellCls}>
                    {isEditing ? <input className={inputCls} defaultValue={r.accountNumber} /> : r.accountNumber}
                  </td>

                  {/* 예금주 */}
                  <td className={cellCls}>
                    {isEditing ? <input className={inputCls} defaultValue={r.accountHolder} /> : r.accountHolder}
                  </td>

                  {/* 청구방식 뱃지 */}
                  <td className={cellCls}><TaxBadge taxType={r.taxType} /></td>

                  {/* 첨부파일 */}
                  <td className={cellCls}><AttachmentCell hasAttachment={r.hasBizCert || r.hasBankbook} /></td>

                  {/* 관리: 연필 아이콘으로 편집 진입, 편집 중엔 저장/취소 */}
                  <td className={cellCls}>
                    {isEditing ? (
                      <div className="flex justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => stopEditing(r.id)}
                          className="whitespace-nowrap rounded bg-[var(--color-success)] px-3 py-1.5 text-xs text-white"
                        >
                          저장
                        </button>
                        <button
                          type="button"
                          onClick={() => stopEditing(r.id)}
                          className="whitespace-nowrap rounded border border-[var(--color-border)] px-3 py-1.5 text-xs"
                        >
                          취소
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEditing(r.id)}
                        className="text-[var(--color-muted)] hover:text-[var(--color-primary)]"
                        aria-label="편집"
                      >
                        ✏️
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rows.length === 0 && (
        <p className="mt-4 text-center text-sm text-[var(--color-muted)]">등록된 지급 대상이 없습니다.</p>
      )}

      {uploadOpen && <PayeeUploadModal open onClose={() => setUploadOpen(false)} />}
    </div>
  );
}
```

- [ ] **Step 3: 컴파일 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add "src/app/(app)/expenses/PayeeUploadModal.tsx" "src/app/(app)/expenses/PayeeListPanel.tsx"
git commit -m "feat(payees): 지급 리스트 화면 + 업로드 모달"
```

---

### Task 10: `/expenses` 2탭 통합(`tabs.ts`, `ExpenseTabs.tsx`, `page.tsx`)

**Files:**
- Create: `src/app/(app)/expenses/tabs.ts`
- Create: `src/app/(app)/expenses/ExpenseTabs.tsx`
- Modify: `src/app/(app)/expenses/page.tsx`

**Interfaces:**
- Consumes: `PayeeListPanel`(Task 9), `listPayees`(Task 4), 기존 `listClients`/`listExpenses`/`ExpenseForm`/`EXPENSE_CATEGORIES`(변경 없음).
- Produces: `type ExpenseTabKey`, `visibleExpenseTabs(role)`, `canAccessExpenseTab(role, tab)`, `DEFAULT_EXPENSE_TAB`, `ExpenseTabs({tabs, current})`.

- [ ] **Step 1: 탭 정의 생성 (2탭만 — 지급요청/법인카드/개인카드는 범위 밖)**

Create `src/app/(app)/expenses/tabs.ts`:

```typescript
import type { AppRole } from "@/lib/auth/rbac";

export type ExpenseTabKey = "all" | "payment-list";

export type ExpenseTab = {
  key: ExpenseTabKey;
  label: string;
  roles: readonly AppRole[];
};

export const EXPENSE_TABS: readonly ExpenseTab[] = [
  { key: "all", label: "전체 내역", roles: ["ADMIN", "SETTLEMENT", "PM"] },
  { key: "payment-list", label: "지급 리스트", roles: ["ADMIN", "SETTLEMENT"] },
];

export const DEFAULT_EXPENSE_TAB: ExpenseTabKey = "all";

// 역할이 볼 수 있는 탭 목록 (탭바 렌더용).
export function visibleExpenseTabs(role: AppRole): readonly ExpenseTab[] {
  return EXPENSE_TABS.filter((tab) => tab.roles.includes(role));
}

// 역할이 특정 탭에 접근 가능한지 (직접 URL 접근 차단용).
// 알 수 없는 탭 문자열, 또는 유효하지만 권한 없는 탭이면 false.
export function canAccessExpenseTab(role: AppRole, tab: string): boolean {
  const found = EXPENSE_TABS.find((t) => t.key === tab);
  return found ? found.roles.includes(role) : false;
}
```

- [ ] **Step 2: 탭 네비게이션 컴포넌트 생성**

Create `src/app/(app)/expenses/ExpenseTabs.tsx`:

```typescript
import Link from "next/link";
import type { ExpenseTab, ExpenseTabKey } from "./tabs";

export function ExpenseTabs({
  tabs,
  current,
}: {
  tabs: readonly ExpenseTab[];
  current: ExpenseTabKey;
}) {
  return (
    <nav className="mb-6 flex flex-wrap gap-1 border-b border-[var(--color-border)]">
      {tabs.map((tab) => {
        const active = tab.key === current;
        return (
          <Link
            key={tab.key}
            href={`/expenses?tab=${tab.key}`}
            className={
              active
                ? "-mb-px border-b-2 border-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-primary)]"
                : "-mb-px border-b-2 border-transparent px-4 py-2 text-sm text-[var(--color-muted)] hover:text-[var(--color-primary)]"
            }
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 3: `page.tsx`를 탭 라우팅 구조로 전체 교체**

Replace `src/app/(app)/expenses/page.tsx` entirely with:

```typescript
import { redirect } from "next/navigation";
import { requireUser, type SessionUser } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { listClients } from "@/lib/data/clients";
import { listExpenses } from "@/lib/data/expenses";
import { listPayees } from "@/lib/data/payees";
import { EXPENSE_CATEGORIES } from "@/lib/validation/schemas";
import { ExpenseForm } from "./ExpenseForm";
import { ExpenseTabs } from "./ExpenseTabs";
import { PayeeListPanel } from "./PayeeListPanel";
import {
  DEFAULT_EXPENSE_TAB,
  canAccessExpenseTab,
  visibleExpenseTabs,
  type ExpenseTabKey,
} from "./tabs";

// 전체 내역 탭 본문 — 기존 카테고리 그리드(+ 조회 필터 폼). 이 탭에서만 지출 DB 조회.
async function AllExpensesTab({
  sp,
  user,
}: {
  sp: { clientId?: string; year?: string; month?: string };
  user: SessionUser;
}) {
  const ctx = getRlsContext(user);
  const clients = await listClients(ctx);

  const clientId = sp.clientId ?? clients[0]?.id;
  const year = Number(sp.year) || 2026;
  const month = Number(sp.month) || 1;

  const existing = clientId ? await listExpenses(ctx, clientId, year, month) : [];
  const byCat = new Map(existing.map((e) => [e.category, e]));
  const rows = EXPENSE_CATEGORIES.map((category) => ({
    category,
    amount: (byCat.get(category)?.amount ?? "") as number | "",
    memo: byCat.get(category)?.memo ?? "",
  }));

  return (
    <>
      {/* 필터 제출 시에도 전체 내역 탭 유지 */}
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <input type="hidden" name="tab" value="all" />
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          고객사
          <select name="clientId" defaultValue={clientId ?? ""} className="mt-1 w-48 rounded border border-[var(--color-border)] px-3 py-2 text-sm">
            {clients.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          연도
          <input type="number" name="year" defaultValue={year} className="mt-1 w-28 rounded border border-[var(--color-border)] px-3 py-2 text-sm" />
        </label>
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          월
          <input type="number" name="month" min="1" max="12" defaultValue={month} className="mt-1 w-24 rounded border border-[var(--color-border)] px-3 py-2 text-sm" />
        </label>
        <button type="submit" className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white">조회</button>
      </form>

      {!clientId ? (
        <p className="text-[var(--color-muted)]">고객사가 없습니다.</p>
      ) : (
        <ExpenseForm clientId={clientId} year={year} month={month} rows={rows} />
      )}
    </>
  );
}

// 지급 리스트 탭 본문 — 공용 원장. ADMIN·SETTLEMENT 전용이라 원문 그대로 표시.
async function PaymentListTab({ user }: { user: SessionUser }) {
  const ctx = getRlsContext(user);
  const rows = await listPayees(ctx);
  return <PayeeListPanel rows={rows} />;
}

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; clientId?: string; year?: string; month?: string }>;
}) {
  const sp = await searchParams;
  const user = await requireUser();
  const role = user.role;
  // ACTIVE 사용자는 role 보유가 불변식. 방어적으로 처리(무한 리다이렉트 방지).
  if (!role) redirect("/");

  const tab = sp.tab ?? DEFAULT_EXPENSE_TAB;
  if (!canAccessExpenseTab(role, tab)) redirect("/expenses");
  const currentTab = tab as ExpenseTabKey;

  const tabs = visibleExpenseTabs(role);

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">지출 입력</h1>
      <ExpenseTabs tabs={tabs} current={currentTab} />
      {currentTab === "all" ? (
        <AllExpensesTab sp={sp} user={user} />
      ) : (
        <PaymentListTab user={user} />
      )}
    </div>
  );
}
```

- [ ] **Step 4: 컴파일 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 5: 커밋**

```bash
git add "src/app/(app)/expenses/tabs.ts" "src/app/(app)/expenses/ExpenseTabs.tsx" "src/app/(app)/expenses/page.tsx"
git commit -m "feat(payees): /expenses에 전체내역·지급리스트 2탭 도입"
```

---

### Task 11: 환경변수 문서화 + 전체 검증

**Files:**
- Modify: `.env.example`

**Interfaces:**
- 없음(최종 통합 검증 태스크).

- [ ] **Step 1: `.env.example`에 암호화 키 안내 추가**

`ALLOWED_EMAIL_DOMAIN="huno.kr"` 다음 줄, `# 프로덕션(Supabase) 값은 .env.production.example 참고.` 앞에 삽입:

```
# 지급 정보(주민번호·계좌번호) 암호화 키 — base64 32바이트 값. 런타임 필수(없으면 암복호화 시 예외).
PAYEE_ENC_KEY=""
# 지급 정보 블라인드 인덱스(정확일치 검색용) HMAC 키 — base64 32바이트 이상 값. 런타임 필수.
PAYEE_BIDX_KEY=""

```

- [ ] **Step 2: 전체 테스트 실행**

Run: `npm test`
Expected: 모든 테스트 파일 PASS (기존 테스트 포함, 회귀 없음). `fileParallelism: false`로 순차 실행되므로 시간이 다소 걸림.

- [ ] **Step 3: 린트**

Run: `npm run lint`
Expected: 에러 없음(경고는 기존 코드베이스 기준과 동일하게 허용).

- [ ] **Step 4: 프로덕션 빌드**

Run: `npm run build`
Expected: `Compiled successfully`. `/expenses`, `/expenses/payees/template` 라우트가 빌드 결과에 포함됨.

- [ ] **Step 5: 개발 서버로 수동 확인**

Run: `npm run dev` (백그라운드) 후 브라우저에서:
1. ADMIN 또는 SETTLEMENT 계정으로 `/expenses` 접속 → "전체 내역"/"지급 리스트" 탭 노출 확인.
2. "지급 리스트" 탭 클릭 → 빈 목록 화면 확인.
3. "+ 등록" → 업로드 모달에서 "엑셀 서식 다운로드" 클릭 → `.xlsx` 파일 다운로드 확인.
4. 다운로드한 서식에 샘플 행 입력 후 업로드 → 목록에 반영 확인.
5. PM 계정으로 `/expenses` 접속 → "지급 리스트" 탭이 보이지 않는지, `/expenses?tab=payment-list` 직접 접근 시 `/expenses`로 리다이렉트되는지 확인.

- [ ] **Step 6: 커밋**

```bash
git add .env.example
git commit -m "docs(payees): 지급 정보 암호화 환경변수 안내"
```

---

## Self-Review 결과

- **Spec coverage:** 설계 문서 1~5절(스키마/데이터계층/UI/스키마+환경변수/테스트) 모두 Task 1~11에 매핑됨. 범위 제외 항목(PayeeAttachment 업로드, 운영 키 등록, 준비중 탭)은 어떤 Task에도 포함하지 않음.
- **Placeholder scan:** 없음 — 모든 Step에 완전한 코드/명령 포함.
- **Type consistency:** `PayeeCreateInput`(Task 4 정의) → Task 6 `build-inputs.ts`가 동일 필드명 사용. `PayeeRow`(Task 4) → Task 9 `PayeeListPanel`이 동일 필드(`bizNumberMasked`, `hasBizCert` 등) 사용. `PayeeUploadState`(Task 7) → Task 9 `PayeeUploadModal`이 동일 필드(`created`, `skipped`, `rowErrors`) 사용. `requireRole("SETTLEMENT")` 사용법이 Task 7/9/10 전체에서 일관됨.
