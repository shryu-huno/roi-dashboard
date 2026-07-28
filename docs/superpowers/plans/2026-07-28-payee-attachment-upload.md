# 지급 리스트 첨부파일 업로드 팝업 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 지급 리스트 테이블의 "첨부파일" 컬럼 클릭 시 뜨는 팝업에서 사업자등록증/통장사본을 Supabase Storage에 업로드·교체·삭제·다운로드할 수 있게 한다.

**Architecture:** Supabase Storage(비공개 버킷) ← 저장소 헬퍼(`src/lib/storage/payee-attachments.ts`) ← 데이터 계층(`src/lib/data/payee-attachments.ts`, Prisma+RLS) ← 서버 액션(`attachment-actions.ts`) ← 클라이언트 모달(`PayeeAttachmentModal.tsx`, `useActionState` + 네이티브 폼). 업로드는 "임시 보관 후 저장 완료 시 일괄 반영" — 기존 `FileDropzone`이 네이티브 폼과 호환되므로 별도 클라이언트 상태 관리 없이 폼 제출 한 번으로 처리한다.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, Prisma 6, PostgreSQL(Supabase), `@supabase/supabase-js`(신규), Vitest 4(실제 테스트 DB 연동, `.env.test` + `test/global-setup.ts`).

## Global Constraints

- 허용 파일 형식: `application/pdf`, `image/jpeg`, `image/png`만. 그 외 거부.
- 최대 파일 크기: 10MB. 초과 시 거부.
- 저장소: Supabase Storage 비공개(private) 버킷 `payee-attachments` (버킷/서비스 롤 키는 이미 발급·배포 완료됨).
- 다운로드는 공개 URL 금지 — 서버가 매번 발급하는 서명 URL(60초 만료)만 사용.
- 권한: 모든 서버 액션은 `requireRole("SETTLEMENT")` 통과 필요 (`ADMIN`도 랭크상 통과) — `src/app/(app)/expenses/payees/actions.ts`의 기존 관례와 동일.
- DB 쓰기는 반드시 `withRLS(ctx, ...)`(`src/lib/rls.ts`) 안에서 수행.
- 하단 "드래그 앤 드롭으로 신규 증빙 파일 추가(고유번호 자동 매칭)" 영역은 이번 범위에서 **구현하지 않는다** (상단 두 슬롯과 기능 중복, 사용자 확인 완료).
- 업로드 이력(버전)은 남기지 않는다 — 교체 시 이전 스토리지 오브젝트는 삭제.
- 참고 스펙: `docs/superpowers/specs/2026-07-28-payee-attachment-upload-design.md`

---

## Task 1: 스키마 — PayeeAttachment 유형당 1개 제약

**Files:**
- Modify: `prisma/schema.prisma:221-232` (`PayeeAttachment` 모델)
- Migration: `prisma/migrations/<timestamp>_add_payee_attachment_unique/migration.sql` (자동 생성)

**Interfaces:**
- Produces: Prisma에서 `payeeAttachment.upsert({ where: { payeeId_fileType: { payeeId, fileType } }, ... })` 사용 가능해짐. Task 3이 이 `where` 키를 사용한다.

- [ ] **Step 1: 스키마에 유니크 제약 추가**

`prisma/schema.prisma`의 `PayeeAttachment` 모델을 다음으로 교체:

```prisma
// 지급 대상 첨부(사업자등록증/통장사본).
model PayeeAttachment {
  id         String        @id @default(cuid())
  payeeId    String
  payee      Payee         @relation(fields: [payeeId], references: [id], onDelete: Cascade)
  fileType   PayeeFileType
  fileUrl    String
  fileName   String
  uploadedAt DateTime      @default(now())

  @@unique([payeeId, fileType])
  @@index([payeeId])
}
```

- [ ] **Step 2: 마이그레이션 생성 및 적용**

Run: `npx prisma migrate dev --name add_payee_attachment_unique`
Expected: `prisma/migrations/` 아래 새 타임스탬프 폴더 생성, `ALTER TABLE "PayeeAttachment" ADD CONSTRAINT ... UNIQUE ("payeeId","fileType")` 포함 SQL 확인.

- [ ] **Step 3: 기존 테스트 스위트가 깨지지 않는지 확인**

Run: `npm test`
Expected: 전체 PASS (기존 `test/payee-rls.test.ts`, `test/data-payees.test.ts` 등 영향 없어야 함).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(payees): PayeeAttachment 유형당 1개로 제약(payeeId+fileType unique)"
```

---

## Task 2: Supabase Storage 헬퍼

**Files:**
- Create: `src/lib/storage/payee-attachments.ts`
- Test: `test/payee-attachment-storage.test.ts`
- Modify: `package.json` (의존성 추가)
- Modify: `.env.example` (키 이름만 추가)

**Interfaces:**
- Consumes: `process.env.SUPABASE_URL`, `process.env.SUPABASE_SERVICE_ROLE_KEY` (이미 Vercel에 등록 완료)
- Produces:
  - `class StorageConfigError extends Error {}`
  - `ALLOWED_MIME: Set<string>`, `MAX_FILE_SIZE: number`
  - `validateAttachmentFile(file: File): string | null` — 에러 메시지 또는 통과 시 `null`
  - `attachmentPath(payeeId: string, fileType: PayeeFileType, fileName: string): string`
  - `uploadPayeeFile(path: string, file: File): Promise<void>`
  - `deletePayeeFile(path: string): Promise<void>`
  - `signedDownloadUrl(path: string): Promise<string>`

- [ ] **Step 1: 의존성 설치**

Run: `npm install @supabase/supabase-js`
Expected: `package.json`의 `dependencies`에 `@supabase/supabase-js` 추가됨.

- [ ] **Step 2: `.env.example`에 키 이름 추가**

`.env.example` 끝에 추가:

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

- [ ] **Step 3: 실패하는 테스트 작성**

`test/payee-attachment-storage.test.ts` 신규 작성:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const uploadMock = vi.fn();
const removeMock = vi.fn();
const createSignedUrlMock = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    storage: {
      from: () => ({
        upload: uploadMock,
        remove: removeMock,
        createSignedUrl: createSignedUrlMock,
      }),
    },
  })),
}));

const ENV_BACKUP = { ...process.env };

import {
  StorageConfigError,
  validateAttachmentFile,
  attachmentPath,
  uploadPayeeFile,
  deletePayeeFile,
  signedDownloadUrl,
} from "@/lib/storage/payee-attachments";

function pdfFile(name = "biz.pdf", size = 1024): File {
  return new File([new Uint8Array(size)], name, { type: "application/pdf" });
}

describe("payee-attachments 저장소 헬퍼", () => {
  beforeEach(() => {
    process.env = { ...ENV_BACKUP, SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc-key" };
    uploadMock.mockReset().mockResolvedValue({ error: null });
    removeMock.mockReset().mockResolvedValue({ error: null });
    createSignedUrlMock.mockReset().mockResolvedValue({ data: { signedUrl: "https://signed.example/x" }, error: null });
  });

  it("validateAttachmentFile: PDF/JPG/PNG·10MB 이하는 통과", () => {
    expect(validateAttachmentFile(pdfFile())).toBeNull();
    expect(validateAttachmentFile(new File([new Uint8Array(1)], "a.jpg", { type: "image/jpeg" }))).toBeNull();
    expect(validateAttachmentFile(new File([new Uint8Array(1)], "a.png", { type: "image/png" }))).toBeNull();
  });

  it("validateAttachmentFile: 허용 외 형식은 거부", () => {
    const f = new File([new Uint8Array(1)], "a.hwp", { type: "application/x-hwp" });
    expect(validateAttachmentFile(f)).toBe("PDF, JPG, PNG 파일만 업로드할 수 있습니다.");
  });

  it("validateAttachmentFile: 10MB 초과는 거부", () => {
    const big = pdfFile("big.pdf", 10 * 1024 * 1024 + 1);
    expect(validateAttachmentFile(big)).toBe("파일 크기는 10MB를 초과할 수 없습니다.");
  });

  it("attachmentPath: payeeId/fileType/토큰-파일명 형식", () => {
    const path = attachmentPath("pay1", "BIZ_CERT", "사업자등록증.pdf");
    expect(path).toMatch(/^pay1\/BIZ_CERT\/[0-9a-f]{16}-사업자등록증\.pdf$/);
  });

  it("uploadPayeeFile: 스토리지 upload 호출, 실패 시 에러 던짐", async () => {
    await uploadPayeeFile("pay1/BIZ_CERT/x-a.pdf", pdfFile());
    expect(uploadMock).toHaveBeenCalledWith("pay1/BIZ_CERT/x-a.pdf", expect.anything(), expect.objectContaining({ contentType: "application/pdf" }));

    uploadMock.mockResolvedValueOnce({ error: { message: "boom" } });
    await expect(uploadPayeeFile("pay1/BIZ_CERT/x-a.pdf", pdfFile())).rejects.toThrow("boom");
  });

  it("deletePayeeFile: 스토리지 remove 호출, 실패 시 에러 던짐", async () => {
    await deletePayeeFile("pay1/BIZ_CERT/x-a.pdf");
    expect(removeMock).toHaveBeenCalledWith(["pay1/BIZ_CERT/x-a.pdf"]);

    removeMock.mockResolvedValueOnce({ error: { message: "boom" } });
    await expect(deletePayeeFile("pay1/BIZ_CERT/x-a.pdf")).rejects.toThrow("boom");
  });

  it("signedDownloadUrl: 60초 만료로 서명 URL 요청, 반환", async () => {
    const url = await signedDownloadUrl("pay1/BIZ_CERT/x-a.pdf");
    expect(createSignedUrlMock).toHaveBeenCalledWith("pay1/BIZ_CERT/x-a.pdf", 60);
    expect(url).toBe("https://signed.example/x");
  });

  it("환경변수 누락 시 StorageConfigError", async () => {
    process.env.SUPABASE_URL = "";
    await expect(uploadPayeeFile("x", pdfFile())).rejects.toThrow(StorageConfigError);
  });
});
```

- [ ] **Step 4: 테스트 실행 → 실패 확인**

Run: `npx vitest run test/payee-attachment-storage.test.ts`
Expected: FAIL — `Cannot find module '@/lib/storage/payee-attachments'`

- [ ] **Step 5: 최소 구현 작성**

`src/lib/storage/payee-attachments.ts` 신규:

```ts
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { PayeeFileType } from "@prisma/client";

export class StorageConfigError extends Error {}

const BUCKET = "payee-attachments";
export const ALLOWED_MIME = new Set(["application/pdf", "image/jpeg", "image/png"]);
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

function client() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new StorageConfigError("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// 사업자등록증/통장사본은 PDF·이미지 스캔본이 일반적이라 형식·크기를 제한한다.
export function validateAttachmentFile(file: File): string | null {
  if (!ALLOWED_MIME.has(file.type)) return "PDF, JPG, PNG 파일만 업로드할 수 있습니다.";
  if (file.size > MAX_FILE_SIZE) return "파일 크기는 10MB를 초과할 수 없습니다.";
  return null;
}

// 충돌 방지용 랜덤 토큰을 파일명 앞에 붙인다.
export function attachmentPath(payeeId: string, fileType: PayeeFileType, fileName: string): string {
  const token = randomBytes(8).toString("hex");
  return `${payeeId}/${fileType}/${token}-${fileName}`;
}

export async function uploadPayeeFile(path: string, file: File): Promise<void> {
  const { error } = await client().storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw new Error(error.message);
}

export async function deletePayeeFile(path: string): Promise<void> {
  const { error } = await client().storage.from(BUCKET).remove([path]);
  if (error) throw new Error(error.message);
}

export async function signedDownloadUrl(path: string): Promise<string> {
  const { data, error } = await client().storage.from(BUCKET).createSignedUrl(path, 60);
  if (error || !data) throw new Error(error?.message ?? "서명 URL 발급 실패");
  return data.signedUrl;
}
```

- [ ] **Step 6: 테스트 실행 → 통과 확인**

Run: `npx vitest run test/payee-attachment-storage.test.ts`
Expected: 전체 PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/storage/payee-attachments.ts test/payee-attachment-storage.test.ts package.json package-lock.json .env.example
git commit -m "feat(payees): Supabase Storage 첨부파일 헬퍼 추가"
```

---

## Task 3: 데이터 계층 — PayeeAttachment CRUD

**Files:**
- Create: `src/lib/data/payee-attachments.ts`
- Test: `test/data-payee-attachments.test.ts`

**Interfaces:**
- Consumes: `withRLS`(`@/lib/rls`), Prisma `payeeAttachment` 모델(Task 1의 `payeeId_fileType` unique)
- Produces:
  - `type PayeeAttachmentRecord = { id: string; fileUrl: string; fileName: string }`
  - `type PayeeAttachmentPair = { bizCert: PayeeAttachmentRecord | null; bankbook: PayeeAttachmentRecord | null }`
  - `getPayeeAttachments(ctx: RlsContext, payeeId: string): Promise<PayeeAttachmentPair>`
  - `upsertPayeeAttachment(ctx: RlsContext, payeeId: string, fileType: PayeeFileType, data: { fileUrl: string; fileName: string }): Promise<PayeeAttachmentRecord>`
  - `deletePayeeAttachment(ctx: RlsContext, payeeId: string, fileType: PayeeFileType): Promise<void>`

- [ ] **Step 1: 실패하는 테스트 작성**

`test/data-payee-attachments.test.ts` 신규 (기존 `test/data-payees.test.ts`의 real-DB 패턴을 그대로 따름):

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { withRLS } from "@/lib/rls";
import { createPayeesBulk } from "@/lib/data/payees";
import { getPayeeAttachments, upsertPayeeAttachment, deletePayeeAttachment } from "@/lib/data/payee-attachments";
import { encrypt, blindIndex, maskBizNumber, maskAccountNumber } from "@/lib/crypto/payee-secret";

const ADMIN = { userId: "seed-admin", role: "ADMIN" as const };

async function reset() {
  await withRLS(ADMIN, async (tx) => {
    await tx.payeeAttachment.deleteMany();
    await tx.payee.deleteMany();
    await tx.$executeRawUnsafe('ALTER SEQUENCE "payee_key_seq_instructor" RESTART WITH 1');
    await tx.$executeRawUnsafe('ALTER SEQUENCE "payee_key_seq_vendor" RESTART WITH 1');
  });
}

async function seedPayee(): Promise<string> {
  const bizDigits = "1234567890";
  await createPayeesBulk(ADMIN, [{
    payeeType: "VENDOR",
    bizName: "업체A",
    bizNumberEnc: encrypt(bizDigits),
    bizNumberMasked: maskBizNumber(bizDigits, "VENDOR"),
    bizNumberBidx: blindIndex(bizDigits),
    phone: "010-1234-5678",
    phoneNormalized: "01012345678",
    bankName: "국민",
    accountNumberEnc: encrypt("110123456789"),
    accountNumberMasked: maskAccountNumber("110123456789"),
    accountHolder: "예금주",
    taxType: "TAX_INVOICE",
  }]);
  const [row] = await withRLS(ADMIN, (tx) => tx.payee.findMany());
  return row.id;
}

describe("payee-attachments 데이터 계층", () => {
  let payeeId: string;
  beforeEach(async () => {
    await reset();
    payeeId = await seedPayee();
  });

  it("첨부가 없으면 둘 다 null", async () => {
    const pair = await getPayeeAttachments(ADMIN, payeeId);
    expect(pair).toEqual({ bizCert: null, bankbook: null });
  });

  it("upsertPayeeAttachment: 신규 생성", async () => {
    const rec = await upsertPayeeAttachment(ADMIN, payeeId, "BIZ_CERT", { fileUrl: "p/1", fileName: "a.pdf" });
    expect(rec.fileName).toBe("a.pdf");
    const pair = await getPayeeAttachments(ADMIN, payeeId);
    expect(pair.bizCert).toMatchObject({ fileUrl: "p/1", fileName: "a.pdf" });
    expect(pair.bankbook).toBeNull();
  });

  it("upsertPayeeAttachment: 같은 fileType 재호출 시 교체(1개 유지)", async () => {
    await upsertPayeeAttachment(ADMIN, payeeId, "BIZ_CERT", { fileUrl: "p/1", fileName: "a.pdf" });
    await upsertPayeeAttachment(ADMIN, payeeId, "BIZ_CERT", { fileUrl: "p/2", fileName: "b.pdf" });
    const pair = await getPayeeAttachments(ADMIN, payeeId);
    expect(pair.bizCert).toMatchObject({ fileUrl: "p/2", fileName: "b.pdf" });
    const all = await withRLS(ADMIN, (tx) => tx.payeeAttachment.findMany({ where: { payeeId, fileType: "BIZ_CERT" } }));
    expect(all).toHaveLength(1);
  });

  it("두 유형은 서로 독립적으로 존재", async () => {
    await upsertPayeeAttachment(ADMIN, payeeId, "BIZ_CERT", { fileUrl: "p/1", fileName: "a.pdf" });
    await upsertPayeeAttachment(ADMIN, payeeId, "BANKBOOK", { fileUrl: "p/2", fileName: "b.pdf" });
    const pair = await getPayeeAttachments(ADMIN, payeeId);
    expect(pair.bizCert?.fileName).toBe("a.pdf");
    expect(pair.bankbook?.fileName).toBe("b.pdf");
  });

  it("deletePayeeAttachment: 해당 유형만 제거", async () => {
    await upsertPayeeAttachment(ADMIN, payeeId, "BIZ_CERT", { fileUrl: "p/1", fileName: "a.pdf" });
    await upsertPayeeAttachment(ADMIN, payeeId, "BANKBOOK", { fileUrl: "p/2", fileName: "b.pdf" });
    await deletePayeeAttachment(ADMIN, payeeId, "BIZ_CERT");
    const pair = await getPayeeAttachments(ADMIN, payeeId);
    expect(pair.bizCert).toBeNull();
    expect(pair.bankbook).not.toBeNull();
  });

  it("deletePayeeAttachment: 없는 걸 지워도 에러 없음", async () => {
    await expect(deletePayeeAttachment(ADMIN, payeeId, "BANKBOOK")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npx vitest run test/data-payee-attachments.test.ts`
Expected: FAIL — `Cannot find module '@/lib/data/payee-attachments'`

- [ ] **Step 3: 최소 구현 작성**

`src/lib/data/payee-attachments.ts` 신규:

```ts
import type { PayeeFileType } from "@prisma/client";
import { withRLS, type RlsContext } from "@/lib/rls";

export type PayeeAttachmentRecord = { id: string; fileUrl: string; fileName: string };
export type PayeeAttachmentPair = { bizCert: PayeeAttachmentRecord | null; bankbook: PayeeAttachmentRecord | null };

export function getPayeeAttachments(ctx: RlsContext, payeeId: string): Promise<PayeeAttachmentPair> {
  return withRLS(ctx, async (tx) => {
    const rows = await tx.payeeAttachment.findMany({ where: { payeeId } });
    const bizCert = rows.find((r) => r.fileType === "BIZ_CERT") ?? null;
    const bankbook = rows.find((r) => r.fileType === "BANKBOOK") ?? null;
    return {
      bizCert: bizCert ? { id: bizCert.id, fileUrl: bizCert.fileUrl, fileName: bizCert.fileName } : null,
      bankbook: bankbook ? { id: bankbook.id, fileUrl: bankbook.fileUrl, fileName: bankbook.fileName } : null,
    };
  });
}

export function upsertPayeeAttachment(
  ctx: RlsContext,
  payeeId: string,
  fileType: PayeeFileType,
  data: { fileUrl: string; fileName: string },
): Promise<PayeeAttachmentRecord> {
  return withRLS(ctx, (tx) =>
    tx.payeeAttachment.upsert({
      where: { payeeId_fileType: { payeeId, fileType } },
      create: { payeeId, fileType, fileUrl: data.fileUrl, fileName: data.fileName },
      update: { fileUrl: data.fileUrl, fileName: data.fileName, uploadedAt: new Date() },
    }),
  );
}

export async function deletePayeeAttachment(ctx: RlsContext, payeeId: string, fileType: PayeeFileType): Promise<void> {
  await withRLS(ctx, (tx) => tx.payeeAttachment.deleteMany({ where: { payeeId, fileType } }));
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npx vitest run test/data-payee-attachments.test.ts`
Expected: 전체 PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/payee-attachments.ts test/data-payee-attachments.test.ts
git commit -m "feat(payees): PayeeAttachment CRUD 데이터 계층 추가"
```

---

## Task 4: 저장/다운로드 오케스트레이션 로직 (ctx 기반, 순수 테스트 가능)

**중요:** 이 프로젝트의 서버 액션 테스트 관례는 `requireRole`/`getSession`을 거치지 않는다. `session.ts`는 `react`의 `cache()`로 감싼 `auth()`를 쓰는데, 이는 요청/렌더 스코프 밖(테스트 프로세스)에서 안정적으로 동작한다는 보장이 없다. 그래서 기존 코드도 `createPayeesBulk` 같은 데이터 계층 함수는 손수 만든 `ctx`로 직접 테스트하고(`test/data-payees.test.ts`), `requireRole`을 호출하는 액션 래퍼 자체는 별도 단위 테스트 없이 얇게 유지한다(`uploadPayeesAction`도 마찬가지). 이 태스크도 같은 원칙을 따라 오케스트레이션 로직을 `ctx: RlsContext`를 인자로 받는 일반 함수로 분리해 테스트하고, Task 6의 "use server" 액션은 `requireRole` → `getRlsContext` → 이 함수 호출로만 구성한 얇은 래퍼로 둔다(래퍼 자체는 Task 7 수동 검증으로 커버).

**Files:**
- Create: `src/app/(app)/expenses/payees/attachment-state.ts`
- Create: `src/app/(app)/expenses/payees/attachment-core.ts`
- Test: `test/payee-attachment-core.test.ts`

**Interfaces:**
- Consumes: Task 3의 `getPayeeAttachments`/`upsertPayeeAttachment`/`deletePayeeAttachment`, Task 2의 `validateAttachmentFile`/`attachmentPath`/`uploadPayeeFile`/`deletePayeeFile`/`signedDownloadUrl`, `RlsContext`(`@/lib/rls`)
- Produces:
  - `type PayeeAttachmentSaveState = ActionState & { bizCertError?: string; bankbookError?: string }`
  - `const PAYEE_ATTACHMENT_SAVE_INIT: PayeeAttachmentSaveState`
  - `saveAttachmentsCore(ctx: RlsContext, formData: FormData): Promise<PayeeAttachmentSaveState>` — 폼 필드: `payeeId`, `bizCertFile`, `bizCertDelete`("true"/미포함), `bankbookFile`, `bankbookDelete`
  - `getDownloadUrlCore(ctx: RlsContext, payeeId: string, fileType: PayeeFileType): Promise<{ ok: true; url: string } | { ok: false; error: string }>`
  - Task 5가 이 두 함수와 `getPayeeAttachments`(Task 3)를 그대로 감싸 서버 액션으로 노출한다.

- [ ] **Step 1: 상태 타입 작성**

`src/app/(app)/expenses/payees/attachment-state.ts` 신규 (기존 `upload-state.ts`와 동일한 이유 — `"use server"` 파일은 함수만 export 가능하므로 타입/상수는 별도 파일에 둔다):

```ts
import type { ActionState } from "@/lib/action-state";

export type PayeeAttachmentSaveState = ActionState & {
  bizCertError?: string;
  bankbookError?: string;
};

export const PAYEE_ATTACHMENT_SAVE_INIT: PayeeAttachmentSaveState = { ok: true };
```

- [ ] **Step 2: 실패하는 테스트 작성**

`test/payee-attachment-core.test.ts` 신규 (`test/data-payees.test.ts`와 동일하게 실제 테스트 DB + 손수 만든 `ADMIN` ctx 사용, storage만 모킹):

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { withRLS } from "@/lib/rls";
import { createPayeesBulk } from "@/lib/data/payees";
import { getPayeeAttachments } from "@/lib/data/payee-attachments";
import { encrypt, blindIndex, maskBizNumber, maskAccountNumber } from "@/lib/crypto/payee-secret";

const ADMIN = { userId: "seed-admin", role: "ADMIN" as const };

const uploadPayeeFile = vi.fn(async () => undefined);
const deletePayeeFile = vi.fn(async () => undefined);
const signedDownloadUrl = vi.fn(async () => "https://signed.example/x");

vi.mock("@/lib/storage/payee-attachments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/payee-attachments")>();
  return { ...actual, uploadPayeeFile, deletePayeeFile, signedDownloadUrl };
});

import { saveAttachmentsCore, getDownloadUrlCore } from "@/app/(app)/expenses/payees/attachment-core";
import { PAYEE_ATTACHMENT_SAVE_INIT } from "@/app/(app)/expenses/payees/attachment-state";

function pdfFile(name = "a.pdf", size = 1024): File {
  return new File([new Uint8Array(size)], name, { type: "application/pdf" });
}

async function reset() {
  await withRLS(ADMIN, async (tx) => {
    await tx.payeeAttachment.deleteMany();
    await tx.payee.deleteMany();
    await tx.$executeRawUnsafe('ALTER SEQUENCE "payee_key_seq_instructor" RESTART WITH 1');
    await tx.$executeRawUnsafe('ALTER SEQUENCE "payee_key_seq_vendor" RESTART WITH 1');
  });
}

async function seedPayee(): Promise<string> {
  const bizDigits = "1234567890";
  await createPayeesBulk(ADMIN, [{
    payeeType: "VENDOR",
    bizName: "업체A",
    bizNumberEnc: encrypt(bizDigits),
    bizNumberMasked: maskBizNumber(bizDigits, "VENDOR"),
    bizNumberBidx: blindIndex(bizDigits),
    phone: "010-1234-5678",
    phoneNormalized: "01012345678",
    bankName: "국민",
    accountNumberEnc: encrypt("110123456789"),
    accountNumberMasked: maskAccountNumber("110123456789"),
    accountHolder: "예금주",
    taxType: "TAX_INVOICE",
  }]);
  const [row] = await withRLS(ADMIN, (tx) => tx.payee.findMany());
  return row.id;
}

describe("attachment-core", () => {
  let payeeId: string;
  beforeEach(async () => {
    vi.clearAllMocks();
    await reset();
    payeeId = await seedPayee();
  });

  it("saveAttachmentsCore: 신규 업로드 성공 시 storage.upload 호출 + DB 반영 + 성공 상태", async () => {
    const fd = new FormData();
    fd.set("payeeId", payeeId);
    fd.set("bizCertFile", pdfFile("biz.pdf"));

    const result = await saveAttachmentsCore(ADMIN, fd);

    expect(result.ok).toBe(true);
    expect(uploadPayeeFile).toHaveBeenCalledTimes(1);
    const after = await getPayeeAttachments(ADMIN, payeeId);
    expect(after.bizCert?.fileName).toBe("biz.pdf");
  });

  it("saveAttachmentsCore: 교체 시 새 파일 업로드 후 이전 오브젝트 삭제", async () => {
    const fd1 = new FormData();
    fd1.set("payeeId", payeeId);
    fd1.set("bizCertFile", pdfFile("first.pdf"));
    await saveAttachmentsCore(ADMIN, fd1);

    const fd2 = new FormData();
    fd2.set("payeeId", payeeId);
    fd2.set("bizCertFile", pdfFile("second.pdf"));
    const result = await saveAttachmentsCore(ADMIN, fd2);

    expect(result.ok).toBe(true);
    expect(deletePayeeFile).toHaveBeenCalledTimes(1);
    const after = await getPayeeAttachments(ADMIN, payeeId);
    expect(after.bizCert?.fileName).toBe("second.pdf");
  });

  it("saveAttachmentsCore: 삭제 플래그 시 storage 삭제 + DB row 제거", async () => {
    const fd1 = new FormData();
    fd1.set("payeeId", payeeId);
    fd1.set("bizCertFile", pdfFile());
    await saveAttachmentsCore(ADMIN, fd1);

    const fd2 = new FormData();
    fd2.set("payeeId", payeeId);
    fd2.set("bizCertDelete", "true");
    const result = await saveAttachmentsCore(ADMIN, fd2);

    expect(result.ok).toBe(true);
    expect(deletePayeeFile).toHaveBeenCalledTimes(1);
    const after = await getPayeeAttachments(ADMIN, payeeId);
    expect(after.bizCert).toBeNull();
  });

  it("saveAttachmentsCore: 잘못된 형식은 해당 슬롯만 에러, 업로드 호출 안 함", async () => {
    const fd = new FormData();
    fd.set("payeeId", payeeId);
    fd.set("bizCertFile", new File([new Uint8Array(1)], "a.hwp", { type: "application/x-hwp" }));
    const result = await saveAttachmentsCore(ADMIN, fd);

    expect(result.ok).toBe(false);
    expect(result.bizCertError).toBe("PDF, JPG, PNG 파일만 업로드할 수 있습니다.");
    expect(uploadPayeeFile).not.toHaveBeenCalled();
  });

  it("saveAttachmentsCore: 한쪽 슬롯 실패해도 다른 슬롯은 반영", async () => {
    const fd = new FormData();
    fd.set("payeeId", payeeId);
    fd.set("bizCertFile", new File([new Uint8Array(1)], "a.hwp", { type: "application/x-hwp" }));
    fd.set("bankbookFile", pdfFile("bank.pdf"));
    const result = await saveAttachmentsCore(ADMIN, fd);

    expect(result.ok).toBe(false);
    expect(result.bizCertError).toBeTruthy();
    expect(result.bankbookError).toBeUndefined();
    const after = await getPayeeAttachments(ADMIN, payeeId);
    expect(after.bankbook?.fileName).toBe("bank.pdf");
  });

  it("getDownloadUrlCore: 파일 있으면 서명 URL 반환", async () => {
    const fd = new FormData();
    fd.set("payeeId", payeeId);
    fd.set("bizCertFile", pdfFile());
    await saveAttachmentsCore(ADMIN, fd);

    const res = await getDownloadUrlCore(ADMIN, payeeId, "BIZ_CERT");
    expect(res).toEqual({ ok: true, url: "https://signed.example/x" });
  });

  it("getDownloadUrlCore: 파일 없으면 에러", async () => {
    const res = await getDownloadUrlCore(ADMIN, payeeId, "BANKBOOK");
    expect(res).toEqual({ ok: false, error: "파일을 찾을 수 없습니다." });
  });
});
```

- [ ] **Step 3: 테스트 실행 → 실패 확인**

Run: `npx vitest run test/payee-attachment-core.test.ts`
Expected: FAIL — `Cannot find module '.../attachment-core'`

- [ ] **Step 4: 최소 구현 작성**

`src/app/(app)/expenses/payees/attachment-core.ts` 신규:

```ts
import type { PayeeFileType } from "@prisma/client";
import type { RlsContext } from "@/lib/rls";
import { getPayeeAttachments, upsertPayeeAttachment, deletePayeeAttachment } from "@/lib/data/payee-attachments";
import {
  validateAttachmentFile, attachmentPath, uploadPayeeFile, deletePayeeFile, signedDownloadUrl,
} from "@/lib/storage/payee-attachments";
import type { PayeeAttachmentSaveState } from "./attachment-state";

// 슬롯 하나(BIZ_CERT 또는 BANKBOOK) 처리. 성공/변경없음이면 undefined, 실패면 에러 메시지.
async function processSlot(
  ctx: RlsContext,
  payeeId: string,
  fileType: PayeeFileType,
  fileField: FormDataEntryValue | null,
  shouldDelete: boolean,
): Promise<string | undefined> {
  const pair = await getPayeeAttachments(ctx, payeeId);
  const existing = fileType === "BIZ_CERT" ? pair.bizCert : pair.bankbook;

  if (shouldDelete) {
    if (!existing) return undefined;
    await deletePayeeFile(existing.fileUrl);
    await deletePayeeAttachment(ctx, payeeId, fileType);
    return undefined;
  }

  if (!(fileField instanceof File) || fileField.size === 0) return undefined; // 변경 없음

  const validationError = validateAttachmentFile(fileField);
  if (validationError) return validationError;

  const path = attachmentPath(payeeId, fileType, fileField.name);
  await uploadPayeeFile(path, fileField); // 업로드 먼저
  await upsertPayeeAttachment(ctx, payeeId, fileType, { fileUrl: path, fileName: fileField.name });
  if (existing) await deletePayeeFile(existing.fileUrl); // 성공 후 이전 파일 정리
  return undefined;
}

export async function saveAttachmentsCore(ctx: RlsContext, formData: FormData): Promise<PayeeAttachmentSaveState> {
  const payeeId = String(formData.get("payeeId") ?? "");
  if (!payeeId) return { ok: false, error: "잘못된 요청입니다." };

  let bizCertError: string | undefined;
  let bankbookError: string | undefined;

  try {
    bizCertError = await processSlot(ctx, payeeId, "BIZ_CERT", formData.get("bizCertFile"), formData.get("bizCertDelete") === "true");
  } catch (e) {
    console.error("[attachment save] 사업자등록증 처리 실패:", e);
    bizCertError = "사업자등록증 처리 중 오류가 발생했습니다.";
  }

  try {
    bankbookError = await processSlot(ctx, payeeId, "BANKBOOK", formData.get("bankbookFile"), formData.get("bankbookDelete") === "true");
  } catch (e) {
    console.error("[attachment save] 통장사본 처리 실패:", e);
    bankbookError = "통장사본 처리 중 오류가 발생했습니다.";
  }

  if (bizCertError || bankbookError) {
    return { ok: false, error: "일부 항목 저장에 실패했습니다.", bizCertError, bankbookError };
  }
  return { ok: true, message: "저장되었습니다." };
}

export async function getDownloadUrlCore(
  ctx: RlsContext,
  payeeId: string,
  fileType: PayeeFileType,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const pair = await getPayeeAttachments(ctx, payeeId);
  const record = fileType === "BIZ_CERT" ? pair.bizCert : pair.bankbook;
  if (!record) return { ok: false, error: "파일을 찾을 수 없습니다." };

  try {
    const url = await signedDownloadUrl(record.fileUrl);
    return { ok: true, url };
  } catch (e) {
    console.error("[attachment download] URL 발급 실패:", e);
    return { ok: false, error: "다운로드 URL 발급에 실패했습니다." };
  }
}
```

- [ ] **Step 5: 테스트 실행 → 통과 확인**

Run: `npx vitest run test/payee-attachment-core.test.ts`
Expected: 전체 PASS

- [ ] **Step 6: 전체 스위트 확인**

Run: `npm test`
Expected: 전체 PASS

- [ ] **Step 7: Commit**

```bash
git add src/app/\(app\)/expenses/payees/attachment-state.ts src/app/\(app\)/expenses/payees/attachment-core.ts test/payee-attachment-core.test.ts
git commit -m "feat(payees): 첨부파일 저장/다운로드 오케스트레이션 로직 추가"
```

---

## Task 5: 서버 액션 래퍼 (조회 · 저장 · 다운로드 URL)

**Files:**
- Create: `src/app/(app)/expenses/payees/attachment-actions.ts`

**Interfaces:**
- Consumes: `requireRole`(`@/lib/auth/session`), `getRlsContext`(`@/lib/context`), Task 3의 `getPayeeAttachments`, Task 4의 `saveAttachmentsCore`/`getDownloadUrlCore`/`PayeeAttachmentSaveState`
- Produces:
  - `getPayeeAttachmentsAction(payeeId: string): Promise<{ bizCert: { fileName: string } | null; bankbook: { fileName: string } | null }>`
  - `saveAttachmentsAction(_prev: PayeeAttachmentSaveState, formData: FormData): Promise<PayeeAttachmentSaveState>`
  - `getAttachmentDownloadUrlAction(payeeId: string, fileType: PayeeFileType): Promise<{ ok: true; url: string } | { ok: false; error: string }>`
  - 단위 테스트 없음(위 "Task 4" 설명 참고) — Task 8 수동 검증으로 커버.

- [ ] **Step 1: 구현 작성**

`src/app/(app)/expenses/payees/attachment-actions.ts` 신규:

```ts
"use server";

import type { PayeeFileType } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { revalidatePath } from "next/cache";
import { getPayeeAttachments } from "@/lib/data/payee-attachments";
import { saveAttachmentsCore, getDownloadUrlCore } from "./attachment-core";
import type { PayeeAttachmentSaveState } from "./attachment-state";

export async function getPayeeAttachmentsAction(payeeId: string): Promise<{
  bizCert: { fileName: string } | null;
  bankbook: { fileName: string } | null;
}> {
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);
  const pair = await getPayeeAttachments(ctx, payeeId);
  return {
    bizCert: pair.bizCert ? { fileName: pair.bizCert.fileName } : null,
    bankbook: pair.bankbook ? { fileName: pair.bankbook.fileName } : null,
  };
}

export async function saveAttachmentsAction(
  _prev: PayeeAttachmentSaveState,
  formData: FormData,
): Promise<PayeeAttachmentSaveState> {
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);
  const result = await saveAttachmentsCore(ctx, formData);
  revalidatePath("/expenses");
  return result;
}

export async function getAttachmentDownloadUrlAction(
  payeeId: string,
  fileType: PayeeFileType,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);
  return getDownloadUrlCore(ctx, payeeId, fileType);
}
```

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/expenses/payees/attachment-actions.ts
git commit -m "feat(payees): 첨부파일 조회/저장/다운로드 서버 액션 래퍼 추가"
```

---

## Task 6: 팝업 UI — PayeeAttachmentModal

**Files:**
- Create: `src/app/(app)/expenses/PayeeAttachmentModal.tsx`

**Interfaces:**
- Consumes: `FileDropzone`(`@/components/FileDropzone`), Task 5의 `getPayeeAttachmentsAction`/`saveAttachmentsAction`/`getAttachmentDownloadUrlAction`, Task 4의 `PAYEE_ATTACHMENT_SAVE_INIT`
- Produces: `<PayeeAttachmentModal open payeeId={string} keyId={string} bizName={string} onClose={() => void} />` — Task 7이 이 컴포넌트를 렌더링.

- [ ] **Step 1: 컴포넌트 작성**

`src/app/(app)/expenses/PayeeAttachmentModal.tsx` 신규:

```tsx
"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PayeeFileType } from "@prisma/client";
import { FileDropzone } from "@/components/FileDropzone";
import {
  getPayeeAttachmentsAction, saveAttachmentsAction, getAttachmentDownloadUrlAction,
} from "./payees/attachment-actions";
import { PAYEE_ATTACHMENT_SAVE_INIT } from "./payees/attachment-state";

type SlotState = { fileName: string } | null;

export function PayeeAttachmentModal({
  open, payeeId, keyId, bizName, onClose,
}: {
  open: boolean;
  payeeId: string;
  keyId: string;
  bizName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(saveAttachmentsAction, PAYEE_ATTACHMENT_SAVE_INIT);
  const [loading, setLoading] = useState(true);
  const [bizCert, setBizCert] = useState<SlotState>(null);
  const [bankbook, setBankbook] = useState<SlotState>(null);
  const [bizCertDelete, setBizCertDelete] = useState(false);
  const [bankbookDelete, setBankbookDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getPayeeAttachmentsAction(payeeId).then((res) => {
      setBizCert(res.bizCert);
      setBankbook(res.bankbook);
      setLoading(false);
    });
  }, [open, payeeId]);

  useEffect(() => {
    if (state.ok && state.message) {
      router.refresh();
      onClose();
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleDownload(fileType: PayeeFileType) {
    const res = await getAttachmentDownloadUrlAction(payeeId, fileType);
    if (res.ok) window.open(res.url, "_blank");
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-[14px] bg-[var(--color-surface)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold">📎 지출 입력 - 첨부파일 관리</h2>
          <button type="button" onClick={onClose} className="text-[var(--color-muted)]" aria-label="닫기">✕</button>
        </div>
        <p className="mb-4 text-sm text-[var(--color-muted)]">
          고유번호 바인딩<br />
          고유번호: {keyId} [업체/강사명: {bizName}]
        </p>

        {loading ? (
          <p className="py-8 text-center text-sm text-[var(--color-muted)]">불러오는 중...</p>
        ) : (
          <form action={formAction}>
            <input type="hidden" name="payeeId" value={payeeId} />

            <AttachmentSlot
              label="사업자등록증(신분증 사본)"
              existing={bizCert}
              fieldName="bizCertFile"
              markedForDelete={bizCertDelete}
              onMarkDelete={setBizCertDelete}
              onDownload={() => handleDownload("BIZ_CERT")}
              errorMessage={state.bizCertError}
            />
            {bizCertDelete && <input type="hidden" name="bizCertDelete" value="true" />}

            <div className="my-4 border-t border-[var(--color-border)]" />

            <AttachmentSlot
              label="통장사본"
              existing={bankbook}
              fieldName="bankbookFile"
              markedForDelete={bankbookDelete}
              onMarkDelete={setBankbookDelete}
              onDownload={() => handleDownload("BANKBOOK")}
              errorMessage={state.bankbookError}
            />
            {bankbookDelete && <input type="hidden" name="bankbookDelete" value="true" />}

            {!state.ok && state.error && (
              <p className="mt-4 text-sm text-[var(--color-danger)]">{state.error}</p>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">
                닫기
              </button>
              <button type="submit" disabled={pending} className="rounded bg-[var(--color-primary)] px-5 py-2 text-sm text-white disabled:opacity-60">
                {pending ? "저장 중..." : "저장 완료"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function AttachmentSlot({
  label, existing, fieldName, markedForDelete, onMarkDelete, onDownload, errorMessage,
}: {
  label: string;
  existing: SlotState;
  fieldName: string;
  markedForDelete: boolean;
  onMarkDelete: (v: boolean) => void;
  onDownload: () => void;
  errorMessage?: string;
}) {
  const [replacing, setReplacing] = useState(false);

  if (markedForDelete) {
    return (
      <div>
        <p className="mb-2 text-sm font-medium">{label}</p>
        <p className="rounded bg-[var(--color-hover)] px-3 py-2 text-sm text-[var(--color-muted)]">
          삭제 예정: {existing?.fileName}
          <button type="button" onClick={() => onMarkDelete(false)} className="ml-3 text-[var(--color-primary)] hover:underline">
            취소
          </button>
        </p>
      </div>
    );
  }

  if (existing && !replacing) {
    return (
      <div>
        <p className="mb-2 text-sm font-medium">{label}</p>
        <div className="flex items-center justify-between rounded border border-[var(--color-border)] px-3 py-2">
          <span className="truncate text-sm">{existing.fileName}</span>
          <div className="flex shrink-0 gap-2 text-sm">
            <button type="button" onClick={onDownload} className="text-[var(--color-primary)] hover:underline">다운로드</button>
            <button type="button" onClick={() => setReplacing(true)} className="text-[var(--color-primary)] hover:underline">교체</button>
            <button type="button" onClick={() => onMarkDelete(true)} className="text-[var(--color-danger)] hover:underline">삭제</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-2 text-sm font-medium">{label}</p>
      <FileDropzone name={fieldName} accept=".pdf,.jpg,.jpeg,.png" label="파일을 이곳에 드래그 앤 드롭 하세요" hint="PDF, JPG, PNG · 10MB 이하" />
      {errorMessage && <p className="mt-1 text-xs text-[var(--color-danger)]">{errorMessage}</p>}
    </div>
  );
}
```

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/expenses/PayeeAttachmentModal.tsx"
git commit -m "feat(payees): 첨부파일 관리 팝업 UI 추가"
```

---

## Task 7: 지급 리스트 테이블에 연결

**Files:**
- Modify: `src/app/(app)/expenses/PayeeListPanel.tsx:36-49` (`AttachmentCell`), `:56-70`(상태 추가), `:214-215`(셀 사용부), `:260`(모달 렌더)

**Interfaces:**
- Consumes: Task 6의 `PayeeAttachmentModal`

- [ ] **Step 1: import 추가 및 `AttachmentCell`을 클릭 가능한 버튼으로 교체**

`src/app/(app)/expenses/PayeeListPanel.tsx:7` 아래에 추가:

```tsx
import { PayeeAttachmentModal } from "./PayeeAttachmentModal";
```

`AttachmentCell` 함수(`:36-49`)를 다음으로 교체:

```tsx
function AttachmentCell({ hasAttachment, onClick }: { hasAttachment: boolean; onClick: () => void }) {
  if (hasAttachment) {
    return (
      <button type="button" onClick={onClick} className="whitespace-nowrap text-sm text-[var(--color-primary)] hover:underline">
        📎 첨부파일
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-block whitespace-nowrap rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-[var(--color-danger)] hover:underline"
    >
      ⚠ 미첨부
    </button>
  );
}
```

- [ ] **Step 2: 선택 상태 추가**

`PayeeListPanel` 함수 내 `const [uploadOpen, setUploadOpen] = useState(false);` (`:69`) 아래에 추가:

```tsx
const [attachmentTarget, setAttachmentTarget] = useState<{ id: string; keyId: string; bizName: string } | null>(null);
```

- [ ] **Step 3: 셀 사용부 연결**

`:215`의

```tsx
<td className={cellCls}><AttachmentCell hasAttachment={r.hasBizCert || r.hasBankbook} /></td>
```

를 다음으로 교체:

```tsx
<td className={cellCls}>
  <AttachmentCell
    hasAttachment={r.hasBizCert || r.hasBankbook}
    onClick={() => setAttachmentTarget({ id: r.id, keyId: r.keyId, bizName: r.bizName })}
  />
</td>
```

- [ ] **Step 4: 모달 렌더 추가**

`:260`의 `{uploadOpen && <PayeeUploadModal open onClose={() => setUploadOpen(false)} />}` 아래에 추가:

```tsx
{attachmentTarget && (
  <PayeeAttachmentModal
    open
    payeeId={attachmentTarget.id}
    keyId={attachmentTarget.keyId}
    bizName={attachmentTarget.bizName}
    onClose={() => setAttachmentTarget(null)}
  />
)}
```

- [ ] **Step 5: 타입 체크 + 전체 테스트**

Run: `npx tsc --noEmit && npm test`
Expected: 에러 없음, 전체 테스트 PASS

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/expenses/PayeeListPanel.tsx"
git commit -m "feat(payees): 첨부파일 컬럼 클릭 시 관리 팝업 연결"
```

---

## Task 8: 수동 검증 (개발 서버)

이 프로젝트는 React 컴포넌트 자동 테스트 도구(testing-library 등)를 쓰지 않으므로(기존 관례), UI 동작은 개발 서버에서 직접 확인한다.

- [ ] **Step 1: 개발 서버 실행**

Run: `npm run dev`

- [ ] **Step 2: 골든 패스 확인**

- `/expenses` → "지급 리스트" 탭에서 "⚠ 미첨부" 행 클릭 → 팝업 오픈, 고유번호/업체명 바인딩 문구 확인
- 사업자등록증 슬롯에 PDF 드래그앤드롭 → "저장 완료" → 팝업 닫힘 + 목록 배지가 "📎 첨부파일"로 갱신 확인
- 다시 열어 파일명 표시 + "다운로드" 클릭 → 새 탭에서 파일 열림 확인
- "교체" 클릭 → 새 파일 업로드 → 저장 → 파일명이 새 파일로 바뀜 확인
- "삭제" 클릭 → "삭제 예정" 표시 → "저장 완료" → 슬롯이 업로드 영역으로 되돌아가는지 확인

- [ ] **Step 3: 예외 케이스 확인**

- 허용 외 형식(.hwp 등) 업로드 시도 → 해당 슬롯에만 에러 메시지, 다른 슬롯은 영향 없는지 확인
- 10MB 초과 파일 업로드 시도 → 에러 메시지 확인
- "닫기" 클릭 시 저장 없이 그냥 닫히는지 확인(파일을 올려놨어도 반영 안 됨)

- [ ] **Step 4: 결과 보고**

문제 없으면 완료. 문제 발견 시 해당 Task로 돌아가 수정.
