# ROI 대시보드 Phase 2A — 엑셀 업로드 임포터 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 정산담당자·관리자가 지출·입금 데이터를 고정 엑셀 양식(.xls/.xlsx)으로 업로드하면, 파싱·검증·미리보기 후 유효 행을 DB에 일괄 반영(덮어쓰기)하는 임포터를 만든다.

**Architecture:** Phase 1의 3층 패턴(순수 함수 + `withRLS` 데이터 계층 + 화면)을 확장한다. 파싱 라이브러리(SheetJS)는 `src/lib/import/xlsx.ts` 한 파일에만 격리하고, 헤더검증·고객사매칭·카테고리매핑·집계는 `string[][]`를 입력받는 순수 함수로 분리한다. 커밋 계층은 기존 upsert 의미를 재사용해 하나의 `withRLS` 트랜잭션에서 순차 반영한다. 서버는 무상태 — 미리보기 결과를 브라우저가 보관했다가 반영 시 재전송한다.

**Tech Stack:** Next.js 16(App Router, React 19), TypeScript 5, Prisma 6(PostgreSQL 16), Vitest 4. **신규 런타임 의존성 1개: `xlsx`(SheetJS).**

## Global Constraints

- **코드 저장소:** `C:\dev\roi-dashboard` (git, 브랜치 `master`). 계획/스펙은 저장소 `docs/`에 커밋, 구글 드라이브 사본은 수동 동기화.
- **선행 설계:** `docs/superpowers/specs/2026-07-10-roi-dashboard-phase2a-excel-import-design.md` (승인됨).
- **DB 접속 역할:** 앱·테스트 모두 비-슈퍼유저 `roi_app`(NOSUPERUSER, NOBYPASSRLS). 슈퍼유저 금지.
- **로컬 테스트 PG:** 포터블 PostgreSQL을 **5433 포트**로 기동. 꺼져 있으면 먼저:
  `/c/dev/pgsql/bin/pg_ctl -D /c/dev/pgdata -o "-p 5433" -l /c/dev/pgdata/server.log start`
- **역할 위계:** `ADMIN > SETTLEMENT > PM`. 업로드 기능은 `requireRole("SETTLEMENT")` 게이트(ADMIN도 통과). RLS의 Expense/Deposit WITH CHECK는 ADMIN/SETTLEMENT를 우회 → 커밋은 전 고객사 통과.
- **모든 DB 접근은 `withRLS` 경유** (User 테이블 제외).
- **금액:** 모든 금액은 `Int`(원 단위), `≥ 0`.
- **연/월 범위:** `year ∈ 2000..2100`, `month ∈ 1..12`.
- **충돌 정책:** 같은 `(clientId, year, month[, category])`는 **덮어쓰기(upsert)**. 파일 내 중복은 **합산**.
- **Prisma 인터랙티브 트랜잭션 주의:** `withRLS` 콜백 안에서 쿼리는 **순차 await**(병렬 금지).
- **경로 별칭:** `@/` → `src/`. 테스트는 `test/**/*.test.ts`, `environment: "node"`(React 컴포넌트 테스트 없음 → UI는 빌드로 검증).
- **테스트/빌드:** `npm test`(vitest run, 로컬 PG 5433 필요), `npm run build`.
- **커밋 메시지 말미:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

**신규 생성 (순수 로직, DB 불필요)**
- `src/lib/import/xlsx.ts` — SheetJS 격리. `readSheet(bytes): string[][]`, `buildXlsx(sheets): Buffer`.
- `src/lib/import/shared.ts` — 타입(`ClientRef`, `PreviewRow`, `ImportPreview`, `ParseResult`) + 헬퍼(`cell`, `normalizeClientName`, `parseAmount`, `parseIntInRange`, `expenseKey`, `depositKey`).
- `src/lib/import/expense-import.ts` — `EXPENSE_HEADERS`, `EXPENSE_CATEGORY_BY_LABEL`, `EXPENSE_CATEGORY_LABELS`, `ExpenseCommitRow`, `parseExpenseRows`.
- `src/lib/import/deposit-import.ts` — `DEPOSIT_HEADERS`, `DepositCommitRow`, `parseDepositRows`.
- `src/lib/import/template.ts` — `buildTemplate(kind): Buffer`, `TEMPLATE_FILENAME`.

**신규 생성 (데이터 계층)**
- `src/lib/data/import.ts` — `getClientRefs`, `getExistingExpenseKeys`, `getExistingDepositKeys`, `commitExpenseImport`, `commitDepositImport`.

**신규 생성 (화면·라우트)**
- `src/app/(app)/settings/import/page.tsx` — 업로드 화면(서버 컴포넌트, 인가 게이트).
- `src/app/(app)/settings/import/ImportClient.tsx` — 파일선택→미리보기→반영(클라이언트 컴포넌트).
- `src/app/(app)/settings/import/actions.ts` — `previewImport`, `commitImport`.
- `src/app/(app)/settings/import/template/[kind]/route.ts` — 템플릿 .xlsx 다운로드.

**수정**
- `src/lib/shell/nav.ts` — SETTLEMENT/ADMIN 메뉴에 "데이터 업로드" 추가.

**테스트**
- `test/import-shared.test.ts`, `test/import-xlsx.test.ts`, `test/import-expense.test.ts`, `test/import-deposit.test.ts`, `test/import-template.test.ts`, `test/data-import.test.ts`, `test/nav.test.ts`(수정).

---

## Task 1: 공통 헬퍼·타입 (import/shared.ts)

**Files:**
- Create: `src/lib/import/shared.ts`, `test/import-shared.test.ts`

**Interfaces:**
- Consumes: 없음(순수).
- Produces:
  - `type ClientRef = { id: string; name: string }`
  - `type RowStatus = "ok" | "error"`
  - `type PreviewRow<T> = { rowNumber: number; status: RowStatus; errors: string[]; merged: boolean; overwrite: boolean; data: T | null }`
  - `type ImportSummary = { applicable: number; overwrite: number; error: number }`
  - `type ImportPreview<T> = { rows: PreviewRow<T>[]; summary: ImportSummary }`
  - `type ParseResult<T> = { ok: false; fileError: string } | { ok: true; preview: ImportPreview<T> }`
  - `cell(row: string[], i: number): string` — 인덱스 안전 접근 + trim.
  - `normalizeClientName(s: string): string` — NFC + trim + 연속공백 축약 + 소문자.
  - `parseAmount(s: string): number | null` — 콤마·"원"·공백 제거 후 정수(음수 허용, 형식오류 null).
  - `parseIntInRange(s: string, min: number, max: number): number | null`.
  - `expenseKey(clientId, year, month, category): string`, `depositKey(clientId, year, month): string`.

- [ ] **Step 1: 실패 테스트 작성**

Create `test/import-shared.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  cell, normalizeClientName, parseAmount, parseIntInRange, expenseKey, depositKey,
} from "@/lib/import/shared";

describe("cell", () => {
  it("returns trimmed string, empty for missing index", () => {
    expect(cell(["  A사 ", "2026"], 0)).toBe("A사");
    expect(cell(["A"], 5)).toBe("");
  });
});

describe("normalizeClientName", () => {
  it("normalizes spaces and case", () => {
    expect(normalizeClientName("  Acme  Corp ")).toBe("acme corp");
    expect(normalizeClientName("A사")).toBe("a사");
  });
});

describe("parseAmount", () => {
  it("strips commas/원/spaces", () => {
    expect(parseAmount("1,000,000원")).toBe(1000000);
    expect(parseAmount(" 5000 ")).toBe(5000);
    expect(parseAmount("-300")).toBe(-300);
  });
  it("returns null for non-numeric/empty", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("1.5")).toBeNull();
  });
});

describe("parseIntInRange", () => {
  it("accepts integers in range", () => {
    expect(parseIntInRange("2026", 2000, 2100)).toBe(2026);
    expect(parseIntInRange("12", 1, 12)).toBe(12);
  });
  it("rejects out of range / non-integer", () => {
    expect(parseIntInRange("1999", 2000, 2100)).toBeNull();
    expect(parseIntInRange("13", 1, 12)).toBeNull();
    expect(parseIntInRange("x", 1, 12)).toBeNull();
  });
});

describe("key builders", () => {
  it("build stable keys", () => {
    expect(expenseKey("c1", 2026, 3, "OPS_FOOD")).toBe("c1|2026|3|OPS_FOOD");
    expect(depositKey("c1", 2026, 3)).toBe("c1|2026|3");
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npm test -- import-shared`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

Create `src/lib/import/shared.ts`:
```ts
export type ClientRef = { id: string; name: string };
export type RowStatus = "ok" | "error";

export type PreviewRow<T> = {
  rowNumber: number; // 헤더 제외 1-based 데이터 행 번호(집계행은 첫 원본 행)
  status: RowStatus;
  errors: string[];
  merged: boolean; // 파일 내 2건 이상 합산됨
  overwrite: boolean; // DB에 이미 값이 있어 덮어씀
  data: T | null; // status === "error"이면 null
};

export type ImportSummary = { applicable: number; overwrite: number; error: number };
export type ImportPreview<T> = { rows: PreviewRow<T>[]; summary: ImportSummary };
export type ParseResult<T> =
  | { ok: false; fileError: string }
  | { ok: true; preview: ImportPreview<T> };

export function cell(row: string[], i: number): string {
  return (row[i] ?? "").toString().trim();
}

export function normalizeClientName(s: string): string {
  return s.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function parseAmount(s: string): number | null {
  const cleaned = s.replace(/[,\s원]/g, "");
  if (cleaned === "" || !/^-?\d+$/.test(cleaned)) return null;
  return Number(cleaned);
}

export function parseIntInRange(s: string, min: number, max: number): number | null {
  const t = s.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
}

export function expenseKey(clientId: string, year: number, month: number, category: string): string {
  return `${clientId}|${year}|${month}|${category}`;
}

export function depositKey(clientId: string, year: number, month: number): string {
  return `${clientId}|${year}|${month}`;
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npm test -- import-shared`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/import/shared.ts test/import-shared.test.ts
git commit -m "$(printf 'feat: add import shared helpers and types\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 2: 지출 파서 (import/expense-import.ts)

**Files:**
- Create: `src/lib/import/expense-import.ts`, `test/import-expense.test.ts`

**Interfaces:**
- Consumes: `@/lib/import/shared` (Task 1), `ExpenseCategory` (`@prisma/client`).
- Produces:
  - `const EXPENSE_HEADERS: readonly string[]` = `["고객사","연","월","카테고리","금액","메모"]`.
  - `const EXPENSE_CATEGORY_BY_LABEL: Record<string, ExpenseCategory>` (13종).
  - `const EXPENSE_CATEGORY_LABELS: string[]`.
  - `type ExpenseCommitRow = { clientId: string; year: number; month: number; category: ExpenseCategory; amount: number }`.
  - `parseExpenseRows(rows: string[][], clients: ClientRef[], existingKeys: Set<string>): ParseResult<ExpenseCommitRow>`.

- [ ] **Step 1: 실패 테스트 작성**

Create `test/import-expense.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseExpenseRows, EXPENSE_HEADERS } from "@/lib/import/expense-import";
import type { ClientRef } from "@/lib/import/shared";
import { expenseKey } from "@/lib/import/shared";

const CLIENTS: ClientRef[] = [
  { id: "cA", name: "A사" },
  { id: "cB", name: "B사" },
];
const H = [...EXPENSE_HEADERS];

function ok<T>(r: { ok: boolean }): asserts r is { ok: true; preview: T } {
  expect(r.ok).toBe(true);
}

describe("parseExpenseRows: header & file errors", () => {
  it("rejects wrong header", () => {
    const r = parseExpenseRows([["고객사", "연", "월"], ["A사", "2026", "3"]], CLIENTS, new Set());
    expect(r.ok).toBe(false);
  });
  it("rejects when no data rows", () => {
    const r = parseExpenseRows([H], CLIENTS, new Set());
    expect(r.ok).toBe(false);
  });
});

describe("parseExpenseRows: valid rows", () => {
  it("maps a clean row to a commit row", () => {
    const r = parseExpenseRows([H, ["A사", "2026", "3", "운영비(식비)", "5,000원", "점심"]], CLIENTS, new Set());
    ok(r);
    expect(r.preview.summary).toEqual({ applicable: 1, overwrite: 0, error: 0 });
    expect(r.preview.rows[0].data).toEqual({ clientId: "cA", year: 2026, month: 3, category: "OPS_FOOD", amount: 5000 });
  });

  it("normalizes client name (case/space) when matching", () => {
    const r = parseExpenseRows([H, [" a사 ", "2026", "3", "법인카드", "1000", ""]], CLIENTS, new Set());
    ok(r);
    expect(r.preview.rows[0].data?.clientId).toBe("cA");
  });

  it("aggregates same (client,month,category) within file", () => {
    const r = parseExpenseRows(
      [H, ["A사", "2026", "3", "운영비(식비)", "5000", ""], ["A사", "2026", "3", "운영비(식비)", "3000", ""]],
      CLIENTS, new Set(),
    );
    ok(r);
    expect(r.preview.summary.applicable).toBe(1);
    const row = r.preview.rows[0];
    expect(row.data?.amount).toBe(8000);
    expect(row.merged).toBe(true);
  });

  it("flags overwrite when key already exists in DB", () => {
    const existing = new Set([expenseKey("cA", 2026, 3, "OPS_FOOD")]);
    const r = parseExpenseRows([H, ["A사", "2026", "3", "운영비(식비)", "5000", ""]], CLIENTS, existing);
    ok(r);
    expect(r.preview.rows[0].overwrite).toBe(true);
    expect(r.preview.summary.overwrite).toBe(1);
  });
});

describe("parseExpenseRows: row errors", () => {
  it("flags unknown client, bad year/month, bad category, bad amount", () => {
    const r = parseExpenseRows(
      [H,
        ["없는회사", "2026", "3", "법인카드", "1000", ""],
        ["A사", "1999", "3", "법인카드", "1000", ""],
        ["A사", "2026", "13", "법인카드", "1000", ""],
        ["A사", "2026", "3", "없는카테고리", "1000", ""],
        ["A사", "2026", "3", "법인카드", "-5", ""],
      ],
      CLIENTS, new Set(),
    );
    ok(r);
    expect(r.preview.summary.error).toBe(5);
    expect(r.preview.summary.applicable).toBe(0);
    expect(r.preview.rows.every((row) => row.status === "error")).toBe(true);
  });

  it("skips fully empty rows silently", () => {
    const r = parseExpenseRows([H, ["", "", "", "", "", ""], ["A사", "2026", "3", "법인카드", "1000", ""]], CLIENTS, new Set());
    ok(r);
    expect(r.preview.summary).toEqual({ applicable: 1, overwrite: 0, error: 0 });
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npm test -- import-expense`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

Create `src/lib/import/expense-import.ts`:
```ts
import type { ExpenseCategory } from "@prisma/client";
import {
  cell, normalizeClientName, parseAmount, parseIntInRange, expenseKey,
  type ClientRef, type ParseResult, type PreviewRow,
} from "./shared";

export const EXPENSE_HEADERS = ["고객사", "연", "월", "카테고리", "금액", "메모"] as const;

export const EXPENSE_CATEGORY_BY_LABEL: Record<string, ExpenseCategory> = {
  "법인카드": "CORPORATE_CARD",
  "개인카드": "PERSONAL_CARD",
  "인건비(상담사)": "LABOR_COUNSELOR",
  "인건비(강사)": "LABOR_INSTRUCTOR",
  "교육&프로그램 진행비": "EDUCATION_PROGRAM",
  "홍보비(오프라인)": "PROMOTION_OFFLINE",
  "홍보비(이벤트)": "PROMOTION_EVENT",
  "운영비(교통비)": "OPS_TRANSPORT",
  "운영비(숙박비)": "OPS_LODGING",
  "운영비(식비)": "OPS_FOOD",
  "운영비(회의비)": "OPS_MEETING",
  "검사지 구매": "TEST_MATERIAL",
  "일반관리(기타)": "GENERAL_ETC",
};

export const EXPENSE_CATEGORY_LABELS = Object.keys(EXPENSE_CATEGORY_BY_LABEL);

export type ExpenseCommitRow = {
  clientId: string;
  year: number;
  month: number;
  category: ExpenseCategory;
  amount: number;
};

export function parseExpenseRows(
  rows: string[][],
  clients: ClientRef[],
  existingKeys: Set<string>,
): ParseResult<ExpenseCommitRow> {
  if (rows.length < 2) return { ok: false, fileError: "데이터 행이 없습니다." };
  const header = rows[0];
  if (!EXPENSE_HEADERS.every((h, i) => cell(header, i) === h)) {
    return { ok: false, fileError: `양식이 올바르지 않습니다. 헤더는 [${EXPENSE_HEADERS.join(", ")}] 여야 합니다.` };
  }

  const byName = new Map(clients.map((c) => [normalizeClientName(c.name), c.id]));
  const errorRows: PreviewRow<ExpenseCommitRow>[] = [];
  const agg = new Map<string, PreviewRow<ExpenseCommitRow>>();

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const nameRaw = cell(r, 0), yearRaw = cell(r, 1), monthRaw = cell(r, 2);
    const catRaw = cell(r, 3), amountRaw = cell(r, 4);
    // 완전 빈 행은 조용히 스킵
    if (!nameRaw && !yearRaw && !monthRaw && !catRaw && !amountRaw) continue;

    const errors: string[] = [];
    const clientId = byName.get(normalizeClientName(nameRaw));
    const year = parseIntInRange(yearRaw, 2000, 2100);
    const month = parseIntInRange(monthRaw, 1, 12);
    const category = EXPENSE_CATEGORY_BY_LABEL[catRaw];
    const amount = parseAmount(amountRaw);

    if (!nameRaw) errors.push("필수값 누락: 고객사");
    else if (!clientId) errors.push(`미등록 고객사: ${nameRaw}`);
    if (year === null) errors.push("연도 범위 오류(2000–2100)");
    if (month === null) errors.push("월 범위 오류(1–12)");
    if (!catRaw) errors.push("필수값 누락: 카테고리");
    else if (!category) errors.push(`알 수 없는 카테고리: ${catRaw}`);
    if (amount === null) errors.push("금액 형식 오류");
    else if (amount < 0) errors.push("금액은 0 이상이어야 합니다");

    if (errors.length > 0) {
      errorRows.push({ rowNumber: i, status: "error", errors, merged: false, overwrite: false, data: null });
      continue;
    }

    const key = expenseKey(clientId!, year!, month!, category!);
    const existing = agg.get(key);
    if (existing) {
      existing.data!.amount += amount!;
      existing.merged = true;
    } else {
      agg.set(key, {
        rowNumber: i,
        status: "ok",
        errors: [],
        merged: false,
        overwrite: existingKeys.has(key),
        data: { clientId: clientId!, year: year!, month: month!, category: category!, amount: amount! },
      });
    }
  }

  const okRows = [...agg.values()];
  return {
    ok: true,
    preview: {
      rows: [...okRows, ...errorRows],
      summary: {
        applicable: okRows.length,
        overwrite: okRows.filter((r) => r.overwrite).length,
        error: errorRows.length,
      },
    },
  };
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npm test -- import-expense`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/import/expense-import.ts test/import-expense.test.ts
git commit -m "$(printf 'feat: add expense excel parser with validation and aggregation\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 3: 입금 파서 (import/deposit-import.ts)

**Files:**
- Create: `src/lib/import/deposit-import.ts`, `test/import-deposit.test.ts`

**Interfaces:**
- Consumes: `@/lib/import/shared` (Task 1).
- Produces:
  - `const DEPOSIT_HEADERS: readonly string[]` = `["고객사","연","월","금액"]`.
  - `type DepositCommitRow = { clientId: string; year: number; month: number; amount: number }`.
  - `parseDepositRows(rows: string[][], clients: ClientRef[], existingKeys: Set<string>): ParseResult<DepositCommitRow>`.

- [ ] **Step 1: 실패 테스트 작성**

Create `test/import-deposit.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseDepositRows, DEPOSIT_HEADERS } from "@/lib/import/deposit-import";
import type { ClientRef } from "@/lib/import/shared";
import { depositKey } from "@/lib/import/shared";

const CLIENTS: ClientRef[] = [{ id: "cA", name: "A사" }];
const H = [...DEPOSIT_HEADERS];

function ok(r: { ok: boolean }): asserts r is { ok: true; preview: any } {
  expect(r.ok).toBe(true);
}

describe("parseDepositRows", () => {
  it("rejects wrong header", () => {
    expect(parseDepositRows([["고객사", "연"], ["A사", "2026"]], CLIENTS, new Set()).ok).toBe(false);
  });

  it("maps a clean row", () => {
    const r = parseDepositRows([H, ["A사", "2026", "3", "20,000원"]], CLIENTS, new Set());
    ok(r);
    expect(r.preview.rows[0].data).toEqual({ clientId: "cA", year: 2026, month: 3, amount: 20000 });
    expect(r.preview.summary).toEqual({ applicable: 1, overwrite: 0, error: 0 });
  });

  it("aggregates same (client,month) within file", () => {
    const r = parseDepositRows([H, ["A사", "2026", "3", "1000"], ["A사", "2026", "3", "2000"]], CLIENTS, new Set());
    ok(r);
    expect(r.preview.summary.applicable).toBe(1);
    expect(r.preview.rows[0].data?.amount).toBe(3000);
    expect(r.preview.rows[0].merged).toBe(true);
  });

  it("flags overwrite from existing keys", () => {
    const r = parseDepositRows([H, ["A사", "2026", "3", "1000"]], CLIENTS, new Set([depositKey("cA", 2026, 3)]));
    ok(r);
    expect(r.preview.rows[0].overwrite).toBe(true);
  });

  it("flags errors for unknown client / bad amount", () => {
    const r = parseDepositRows([H, ["없는회사", "2026", "3", "1000"], ["A사", "2026", "3", "abc"]], CLIENTS, new Set());
    ok(r);
    expect(r.preview.summary.error).toBe(2);
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npm test -- import-deposit`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

Create `src/lib/import/deposit-import.ts`:
```ts
import {
  cell, normalizeClientName, parseAmount, parseIntInRange, depositKey,
  type ClientRef, type ParseResult, type PreviewRow,
} from "./shared";

export const DEPOSIT_HEADERS = ["고객사", "연", "월", "금액"] as const;

export type DepositCommitRow = {
  clientId: string;
  year: number;
  month: number;
  amount: number;
};

export function parseDepositRows(
  rows: string[][],
  clients: ClientRef[],
  existingKeys: Set<string>,
): ParseResult<DepositCommitRow> {
  if (rows.length < 2) return { ok: false, fileError: "데이터 행이 없습니다." };
  const header = rows[0];
  if (!DEPOSIT_HEADERS.every((h, i) => cell(header, i) === h)) {
    return { ok: false, fileError: `양식이 올바르지 않습니다. 헤더는 [${DEPOSIT_HEADERS.join(", ")}] 여야 합니다.` };
  }

  const byName = new Map(clients.map((c) => [normalizeClientName(c.name), c.id]));
  const errorRows: PreviewRow<DepositCommitRow>[] = [];
  const agg = new Map<string, PreviewRow<DepositCommitRow>>();

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const nameRaw = cell(r, 0), yearRaw = cell(r, 1), monthRaw = cell(r, 2), amountRaw = cell(r, 3);
    if (!nameRaw && !yearRaw && !monthRaw && !amountRaw) continue;

    const errors: string[] = [];
    const clientId = byName.get(normalizeClientName(nameRaw));
    const year = parseIntInRange(yearRaw, 2000, 2100);
    const month = parseIntInRange(monthRaw, 1, 12);
    const amount = parseAmount(amountRaw);

    if (!nameRaw) errors.push("필수값 누락: 고객사");
    else if (!clientId) errors.push(`미등록 고객사: ${nameRaw}`);
    if (year === null) errors.push("연도 범위 오류(2000–2100)");
    if (month === null) errors.push("월 범위 오류(1–12)");
    if (amount === null) errors.push("금액 형식 오류");
    else if (amount < 0) errors.push("금액은 0 이상이어야 합니다");

    if (errors.length > 0) {
      errorRows.push({ rowNumber: i, status: "error", errors, merged: false, overwrite: false, data: null });
      continue;
    }

    const key = depositKey(clientId!, year!, month!);
    const existing = agg.get(key);
    if (existing) {
      existing.data!.amount += amount!;
      existing.merged = true;
    } else {
      agg.set(key, {
        rowNumber: i,
        status: "ok",
        errors: [],
        merged: false,
        overwrite: existingKeys.has(key),
        data: { clientId: clientId!, year: year!, month: month!, amount: amount! },
      });
    }
  }

  const okRows = [...agg.values()];
  return {
    ok: true,
    preview: {
      rows: [...okRows, ...errorRows],
      summary: {
        applicable: okRows.length,
        overwrite: okRows.filter((r) => r.overwrite).length,
        error: errorRows.length,
      },
    },
  };
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npm test -- import-deposit`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/import/deposit-import.ts test/import-deposit.test.ts
git commit -m "$(printf 'feat: add deposit excel parser\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 4: SheetJS 어댑터 (import/xlsx.ts)

**Files:**
- Create: `src/lib/import/xlsx.ts`, `test/import-xlsx.test.ts`
- Modify: `package.json` (의존성 `xlsx` 추가)

**Interfaces:**
- Consumes: `xlsx`(SheetJS).
- Produces:
  - `readSheet(data: Buffer | ArrayBuffer): string[][]` — 첫 시트를 문자열 2차원 배열로. 완전 빈 행 제거.
  - `buildXlsx(sheets: { name: string; rows: string[][] }[]): Buffer` — .xlsx 버퍼 생성(템플릿용).

- [ ] **Step 1: 의존성 설치 (패치 버전 고정)**

npm 배포판(`xlsx@0.18.5`)은 prototype-pollution 취약점이 있으므로, SheetJS 공식 배포 채널의 패치 버전을 설치한다.
```bash
cd /c/dev/roi-dashboard
npm install --save-exact https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
```
확인: `package.json`의 `dependencies`에 `"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"`가 추가됨.
> 위 채널이 막혀 있으면 대안: `npm install --save-exact xlsx@0.20.3` (npm 미러에 존재 시). 어느 쪽이든 **0.20.3 이상**을 고정한다.

- [ ] **Step 2: 실패 테스트 작성**

Create `test/import-xlsx.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { readSheet, buildXlsx } from "@/lib/import/xlsx";

function book(rows: (string | number)[][], bookType: "xlsx" | "biff8"): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType }) as Buffer;
}

const ROWS = [["고객사", "금액"], ["A사", 1000], ["B사", 2000]];

describe("readSheet", () => {
  it("reads .xlsx into string[][]", () => {
    expect(readSheet(book(ROWS, "xlsx"))).toEqual([["고객사", "금액"], ["A사", "1000"], ["B사", "2000"]]);
  });
  it("reads legacy .xls (biff8) into string[][]", () => {
    expect(readSheet(book(ROWS, "biff8"))).toEqual([["고객사", "금액"], ["A사", "1000"], ["B사", "2000"]]);
  });
});

describe("buildXlsx", () => {
  it("round-trips rows through a generated xlsx", () => {
    const buf = buildXlsx([{ name: "양식", rows: [["고객사", "연"], ["A사", "2026"]] }]);
    expect(readSheet(buf)).toEqual([["고객사", "연"], ["A사", "2026"]]);
  });
});
```

- [ ] **Step 3: 테스트 실행 → 실패 확인**

Run: `npm test -- import-xlsx`
Expected: FAIL — `@/lib/import/xlsx` 없음.

- [ ] **Step 4: 구현**

Create `src/lib/import/xlsx.ts`:
```ts
import * as XLSX from "xlsx";

/** 첫 시트를 문자열 2차원 배열로 읽는다. 완전 빈 행은 제거. 라이브러리 격리 지점. */
export function readSheet(data: Buffer | ArrayBuffer): string[][] {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(new Uint8Array(data));
  const wb = XLSX.read(buf, { type: "buffer" });
  const name = wb.SheetNames[0];
  if (!name) return [];
  const ws = wb.Sheets[name];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: "" });
  return aoa.map((row) => row.map((c) => (c == null ? "" : String(c))));
}

/** 문자열 2차원 배열들을 .xlsx 버퍼로 만든다(템플릿 생성용). */
export function buildXlsx(sheets: { name: string; rows: string[][] }[]): Buffer {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
```

- [ ] **Step 5: 테스트 실행 → 통과 확인**

Run: `npm test -- import-xlsx`
Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add package.json package-lock.json src/lib/import/xlsx.ts test/import-xlsx.test.ts
git commit -m "$(printf 'feat: add SheetJS xlsx/xls adapter (readSheet, buildXlsx)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 5: 템플릿 생성 (import/template.ts + 다운로드 라우트)

**Files:**
- Create: `src/lib/import/template.ts`, `test/import-template.test.ts`
- Create: `src/app/(app)/settings/import/template/[kind]/route.ts`

**Interfaces:**
- Consumes: `buildXlsx`(Task 4), `EXPENSE_HEADERS`/`EXPENSE_CATEGORY_LABELS`(Task 2), `DEPOSIT_HEADERS`(Task 3), `readSheet`(테스트용).
- Produces:
  - `type ImportKind = "expense" | "deposit"`.
  - `buildTemplate(kind: ImportKind): Buffer`.
  - `templateFilename(kind: ImportKind): string`.
  - Route `GET /settings/import/template/expense|deposit` → .xlsx 첨부 다운로드(SETTLEMENT+ 게이트).

- [ ] **Step 1: 실패 테스트 작성**

Create `test/import-template.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildTemplate } from "@/lib/import/template";
import { readSheet } from "@/lib/import/xlsx";
import { EXPENSE_HEADERS } from "@/lib/import/expense-import";
import { DEPOSIT_HEADERS } from "@/lib/import/deposit-import";

describe("buildTemplate", () => {
  it("expense template first row equals EXPENSE_HEADERS", () => {
    const rows = readSheet(buildTemplate("expense"));
    expect(rows[0]).toEqual([...EXPENSE_HEADERS]);
  });
  it("deposit template first row equals DEPOSIT_HEADERS", () => {
    const rows = readSheet(buildTemplate("deposit"));
    expect(rows[0]).toEqual([...DEPOSIT_HEADERS]);
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npm test -- import-template`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현 (template.ts)**

Create `src/lib/import/template.ts`:
```ts
import { buildXlsx } from "./xlsx";
import { EXPENSE_HEADERS, EXPENSE_CATEGORY_LABELS } from "./expense-import";
import { DEPOSIT_HEADERS } from "./deposit-import";

export type ImportKind = "expense" | "deposit";

export function buildTemplate(kind: ImportKind): Buffer {
  if (kind === "expense") {
    return buildXlsx([
      { name: "지출", rows: [[...EXPENSE_HEADERS]] },
      { name: "카테고리 안내", rows: [["사용 가능한 카테고리"], ...EXPENSE_CATEGORY_LABELS.map((l) => [l])] },
    ]);
  }
  return buildXlsx([{ name: "입금", rows: [[...DEPOSIT_HEADERS]] }]);
}

export function templateFilename(kind: ImportKind): string {
  return kind === "expense" ? "지출_업로드_양식.xlsx" : "입금_업로드_양식.xlsx";
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npm test -- import-template`
Expected: PASS.

- [ ] **Step 5: 구현 (다운로드 라우트)**

Create `src/app/(app)/settings/import/template/[kind]/route.ts`:
```ts
import { requireRole } from "@/lib/auth/session";
import { buildTemplate, templateFilename, type ImportKind } from "@/lib/import/template";

export async function GET(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  await requireRole("SETTLEMENT");
  const { kind } = await params;
  if (kind !== "expense" && kind !== "deposit") return new Response("Not found", { status: 404 });
  const buf = buildTemplate(kind as ImportKind);
  const filename = encodeURIComponent(templateFilename(kind as ImportKind));
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
```

- [ ] **Step 6: 빌드 확인**

Run: `npm run build`
Expected: 성공(타입 통과).

- [ ] **Step 7: 커밋**

```bash
git add src/lib/import/template.ts test/import-template.test.ts "src/app/(app)/settings/import/template/[kind]/route.ts"
git commit -m "$(printf 'feat: add excel template builder and download route\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 6: 데이터 계층 — 조회·커밋 (data/import.ts)

**Files:**
- Create: `src/lib/data/import.ts`, `test/data-import.test.ts`

**Interfaces:**
- Consumes: `withRLS`/`RlsContext`(`@/lib/rls`), `expenseKey`/`depositKey`/`ClientRef`(`@/lib/import/shared`), `ExpenseCommitRow`(Task 2), `DepositCommitRow`(Task 3).
- Produces:
  - `getClientRefs(ctx): Promise<ClientRef[]>`.
  - `getExistingExpenseKeys(ctx): Promise<Set<string>>`.
  - `getExistingDepositKeys(ctx): Promise<Set<string>>`.
  - `commitExpenseImport(ctx, rows: ExpenseCommitRow[]): Promise<{ applied: number }>`.
  - `commitDepositImport(ctx, rows: DepositCommitRow[]): Promise<{ applied: number }>`.

- [ ] **Step 1: 실패 테스트 작성**

Create `test/data-import.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS } from "@/lib/rls";
import { createClient } from "@/lib/data/clients";
import {
  getClientRefs, getExistingExpenseKeys, getExistingDepositKeys,
  commitExpenseImport, commitDepositImport,
} from "@/lib/data/import";
import { expenseKey } from "@/lib/import/shared";

const ADMIN = { userId: "seed-admin", role: "ADMIN" as const };

async function reset() {
  await withRLS(ADMIN, async (tx) => {
    await tx.expense.deleteMany();
    await tx.monthlyDeposit.deleteMany();
    await tx.task.deleteMany();
    await tx.client.deleteMany();
  });
  await prisma.user.deleteMany();
}

describe("data/import", () => {
  let pmA: string, clientA: string, clientB: string;
  beforeEach(async () => {
    await reset();
    pmA = (await prisma.user.create({ data: { email: "pma@huno.kr", role: "PM", status: "ACTIVE" } })).id;
    clientA = (await createClient(ADMIN, { name: "A사", pmIds: [pmA] })).id;
    clientB = (await createClient(ADMIN, { name: "B사" })).id;
  });

  it("getClientRefs returns id+name (RLS scope)", async () => {
    const refs = await getClientRefs(ADMIN);
    expect(refs.map((r) => r.name).sort()).toEqual(["A사", "B사"]);
  });

  it("commitExpenseImport inserts rows for multiple clients", async () => {
    const res = await commitExpenseImport(ADMIN, [
      { clientId: clientA, year: 2026, month: 3, category: "OPS_FOOD", amount: 5000 },
      { clientId: clientB, year: 2026, month: 3, category: "CORPORATE_CARD", amount: 7000 },
    ]);
    expect(res.applied).toBe(2);
    const rows = await withRLS(ADMIN, (tx) => tx.expense.findMany());
    expect(rows).toHaveLength(2);
  });

  it("commitExpenseImport overwrites existing (idempotent amount)", async () => {
    const row = { clientId: clientA, year: 2026, month: 3, category: "OPS_FOOD" as const, amount: 5000 };
    await commitExpenseImport(ADMIN, [row]);
    await commitExpenseImport(ADMIN, [{ ...row, amount: 9000 }]);
    const rows = await withRLS(ADMIN, (tx) => tx.expense.findMany());
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(9000);
  });

  it("getExistingExpenseKeys reflects committed rows", async () => {
    await commitExpenseImport(ADMIN, [{ clientId: clientA, year: 2026, month: 3, category: "OPS_FOOD", amount: 5000 }]);
    const keys = await getExistingExpenseKeys(ADMIN);
    expect(keys.has(expenseKey(clientA, 2026, 3, "OPS_FOOD"))).toBe(true);
  });

  it("commitDepositImport upserts deposits", async () => {
    await commitDepositImport(ADMIN, [{ clientId: clientA, year: 2026, month: 3, amount: 20000 }]);
    const keys = await getExistingDepositKeys(ADMIN);
    expect(keys.size).toBe(1);
  });

  it("rejects invalid row (negative amount) before writing", async () => {
    await expect(
      commitExpenseImport(ADMIN, [{ clientId: clientA, year: 2026, month: 3, category: "OPS_FOOD", amount: -1 }]),
    ).rejects.toThrow();
  });

  it("RLS blocks a PM committing for a client they do not manage", async () => {
    await expect(
      commitExpenseImport({ userId: pmA, role: "PM" }, [
        { clientId: clientB, year: 2026, month: 3, category: "OPS_FOOD", amount: 1000 },
      ]),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

로컬 PG(5433)가 켜져 있어야 한다.
Run: `npm test -- data-import`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

Create `src/lib/data/import.ts`:
```ts
import { withRLS, type RlsContext } from "@/lib/rls";
import { expenseKey, depositKey, type ClientRef } from "@/lib/import/shared";
import type { ExpenseCommitRow } from "@/lib/import/expense-import";
import type { DepositCommitRow } from "@/lib/import/deposit-import";

export function getClientRefs(ctx: RlsContext): Promise<ClientRef[]> {
  return withRLS(ctx, (tx) => tx.client.findMany({ select: { id: true, name: true } }));
}

export function getExistingExpenseKeys(ctx: RlsContext): Promise<Set<string>> {
  return withRLS(ctx, async (tx) => {
    const rows = await tx.expense.findMany({ select: { clientId: true, year: true, month: true, category: true } });
    return new Set(rows.map((r) => expenseKey(r.clientId, r.year, r.month, r.category)));
  });
}

export function getExistingDepositKeys(ctx: RlsContext): Promise<Set<string>> {
  return withRLS(ctx, async (tx) => {
    const rows = await tx.monthlyDeposit.findMany({ select: { clientId: true, year: true, month: true } });
    return new Set(rows.map((r) => depositKey(r.clientId, r.year, r.month)));
  });
}

function assertYearMonthAmount(year: number, month: number, amount: number): void {
  const okYear = Number.isInteger(year) && year >= 2000 && year <= 2100;
  const okMonth = Number.isInteger(month) && month >= 1 && month <= 12;
  const okAmount = Number.isInteger(amount) && amount >= 0;
  if (!okYear || !okMonth || !okAmount) throw new Error("유효하지 않은 행이 포함되어 있습니다.");
}

export function commitExpenseImport(ctx: RlsContext, rows: ExpenseCommitRow[]): Promise<{ applied: number }> {
  for (const r of rows) assertYearMonthAmount(r.year, r.month, r.amount);
  return withRLS(ctx, async (tx) => {
    for (const r of rows) {
      await tx.expense.upsert({
        where: { clientId_year_month_category: { clientId: r.clientId, year: r.year, month: r.month, category: r.category } },
        create: { clientId: r.clientId, year: r.year, month: r.month, category: r.category, amount: r.amount, memo: null },
        update: { amount: r.amount },
      });
    }
    return { applied: rows.length };
  });
}

export function commitDepositImport(ctx: RlsContext, rows: DepositCommitRow[]): Promise<{ applied: number }> {
  for (const r of rows) assertYearMonthAmount(r.year, r.month, r.amount);
  return withRLS(ctx, async (tx) => {
    for (const r of rows) {
      await tx.monthlyDeposit.upsert({
        where: { clientId_year_month: { clientId: r.clientId, year: r.year, month: r.month } },
        create: { clientId: r.clientId, year: r.year, month: r.month, amount: r.amount },
        update: { amount: r.amount },
      });
    }
    return { applied: rows.length };
  });
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npm test -- data-import`
Expected: PASS (7 passed).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/data/import.ts test/data-import.test.ts
git commit -m "$(printf 'feat: add import data layer (client refs, existing keys, commit) with RLS\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 7: 네비게이션에 "데이터 업로드" 추가 (nav.ts)

**Files:**
- Modify: `src/lib/shell/nav.ts`
- Modify: `test/nav.test.ts`

**Interfaces:**
- Consumes: `AppRole`.
- Produces: SETTLEMENT/ADMIN 메뉴에 `/settings/import`가 `/settings/clients` 다음에 포함. PM·null 미포함.

- [ ] **Step 1: 테스트를 새 기대로 수정 (실패 확인용)**

`test/nav.test.ts`의 SETTLEMENT·ADMIN 기대 배열을 아래로 교체(대시보드 이후 순서 유지):
```ts
  it("SETTLEMENT adds settings and import", () => {
    expect(hrefs("SETTLEMENT")).toEqual(["/dashboard", "/clients", "/performance", "/expenses", "/billing", "/settings/clients", "/settings/import"]);
  });
  it("ADMIN adds user management", () => {
    expect(hrefs("ADMIN")).toEqual(["/dashboard", "/clients", "/performance", "/expenses", "/billing", "/settings/clients", "/settings/import", "/admin/users"]);
  });
```
(다른 it 블록 — PM, null — 은 그대로 둔다.)

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npm test -- nav`
Expected: FAIL — `/settings/import` 없음.

- [ ] **Step 3: 구현**

`src/lib/shell/nav.ts`의 설정 블록을 아래로 교체:
```ts
  // 고객사·과업·단가 설정, 데이터 업로드는 정산담당자/관리자만.
  if (role === "SETTLEMENT" || role === "ADMIN") {
    items.push({ href: "/settings/clients", label: "설정" });
    items.push({ href: "/settings/import", label: "데이터 업로드" });
  }
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npm test -- nav`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/shell/nav.ts test/nav.test.ts
git commit -m "$(printf 'feat: add data upload nav item for settlement and admin\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 8: 서버 액션 (settings/import/actions.ts)

**Files:**
- Create: `src/app/(app)/settings/import/actions.ts`

**Interfaces:**
- Consumes: `requireRole`, `getRlsContext`, Task 2·3(파서), Task 4(readSheet), Task 6(데이터 계층), `revalidatePath`.
- Produces (클라이언트 컴포넌트가 호출):
  - `type PreviewResult = { ok: false; error: string } | { ok: true; kind: ImportKind; preview: ImportPreview<CommitRow> }` (지출·입금 공용 — `CommitRow = ExpenseCommitRow | DepositCommitRow`).
  - `previewImport(formData: FormData): Promise<PreviewResult>` — FormData: `kind`("expense"|"deposit"), `file`(File).
  - `commitImport(kind: ImportKind, rows: unknown[]): Promise<{ ok: boolean; applied?: number; error?: string }>`.
- 검증: 단위 테스트 없음(auth 의존). `npm run build`로 타입/컴파일 검증.

- [ ] **Step 1: 구현**

Create `src/app/(app)/settings/import/actions.ts`:
```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { readSheet } from "@/lib/import/xlsx";
import { parseExpenseRows, type ExpenseCommitRow } from "@/lib/import/expense-import";
import { parseDepositRows, type DepositCommitRow } from "@/lib/import/deposit-import";
import type { ImportKind } from "@/lib/import/template";
import type { ImportPreview } from "@/lib/import/shared";
import {
  getClientRefs, getExistingExpenseKeys, getExistingDepositKeys,
  commitExpenseImport, commitDepositImport,
} from "@/lib/data/import";

type AnyRow = ExpenseCommitRow | DepositCommitRow;
export type PreviewResult =
  | { ok: false; error: string }
  | { ok: true; kind: ImportKind; preview: ImportPreview<AnyRow> };

export async function previewImport(formData: FormData): Promise<PreviewResult> {
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);
  const kind = String(formData.get("kind"));
  const file = formData.get("file");
  if (kind !== "expense" && kind !== "deposit") return { ok: false, error: "업로드 종류가 올바르지 않습니다." };
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "파일을 선택하세요." };

  let rows: string[][];
  try {
    rows = readSheet(Buffer.from(await file.arrayBuffer()));
  } catch {
    return { ok: false, error: "파일을 읽을 수 없습니다(.xls/.xlsx만 지원)." };
  }

  const clients = await getClientRefs(ctx);
  if (kind === "expense") {
    const existing = await getExistingExpenseKeys(ctx);
    const res = parseExpenseRows(rows, clients, existing);
    if (!res.ok) return { ok: false, error: res.fileError };
    return { ok: true, kind, preview: res.preview };
  } else {
    const existing = await getExistingDepositKeys(ctx);
    const res = parseDepositRows(rows, clients, existing);
    if (!res.ok) return { ok: false, error: res.fileError };
    return { ok: true, kind, preview: res.preview };
  }
}

export async function commitImport(
  kind: ImportKind,
  rows: unknown[],
): Promise<{ ok: boolean; applied?: number; error?: string }> {
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);
  try {
    if (kind === "expense") {
      const { applied } = await commitExpenseImport(ctx, rows as ExpenseCommitRow[]);
      revalidatePath("/dashboard");
      return { ok: true, applied };
    } else if (kind === "deposit") {
      const { applied } = await commitDepositImport(ctx, rows as DepositCommitRow[]);
      revalidatePath("/dashboard");
      return { ok: true, applied };
    }
    return { ok: false, error: "업로드 종류가 올바르지 않습니다." };
  } catch {
    return { ok: false, error: "반영 중 오류가 발생했습니다. 데이터를 확인하세요." };
  }
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 성공.

- [ ] **Step 3: 커밋**

```bash
git add "src/app/(app)/settings/import/actions.ts"
git commit -m "$(printf 'feat: add import preview and commit server actions\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 9: 업로드 화면 (page + ImportClient)

**Files:**
- Create: `src/app/(app)/settings/import/page.tsx`
- Create: `src/app/(app)/settings/import/ImportClient.tsx`

**Interfaces:**
- Consumes: `requireRole`(page 게이트), Task 8 액션, Task 1 타입.
- Produces: `/settings/import` 화면 — 종류 선택(지출/입금), 템플릿 다운로드 링크, 파일 업로드 → 미리보기 표 → 반영.
- 검증: `npm run build`.

- [ ] **Step 1: 구현 (page.tsx — 서버 컴포넌트 게이트)**

Create `src/app/(app)/settings/import/page.tsx`:
```tsx
import { requireRole } from "@/lib/auth/session";
import { ImportClient } from "./ImportClient";

export default async function ImportPage() {
  await requireRole("SETTLEMENT");
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">데이터 업로드</h1>
      <p className="mb-6 text-sm text-[var(--color-muted)]">
        지출·입금 데이터를 엑셀 양식(.xls/.xlsx)으로 업로드합니다. 먼저 양식을 내려받아 작성한 뒤 업로드하세요.
      </p>
      <ImportClient />
    </div>
  );
}
```

- [ ] **Step 2: 구현 (ImportClient.tsx — 업로드·미리보기·반영)**

Create `src/app/(app)/settings/import/ImportClient.tsx`:
```tsx
"use client";

import { useState } from "react";
import { previewImport, commitImport, type PreviewResult } from "./actions";
import type { ImportKind } from "@/lib/import/template";
import type { ImportPreview } from "@/lib/import/shared";

type AnyRow = { clientId: string; year: number; month: number; amount: number; category?: string };

export function ImportClient() {
  const [kind, setKind] = useState<ImportKind>("expense");
  const [preview, setPreview] = useState<ImportPreview<AnyRow> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onPreview(formData: FormData) {
    setError(null); setMessage(null); setPreview(null); setBusy(true);
    formData.set("kind", kind);
    const res: PreviewResult = await previewImport(formData);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setPreview(res.preview as ImportPreview<AnyRow>);
  }

  async function onCommit() {
    if (!preview) return;
    setBusy(true); setError(null); setMessage(null);
    const rows = preview.rows.filter((r) => r.status === "ok").map((r) => r.data!);
    const res = await commitImport(kind, rows);
    setBusy(false);
    if (!res.ok) { setError(res.error ?? "반영 실패"); return; }
    setMessage(`${res.applied}건 반영 완료`);
    setPreview(null);
  }

  const applicable = preview?.summary.applicable ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          종류
          <select
            value={kind}
            onChange={(e) => { setKind(e.target.value as ImportKind); setPreview(null); setError(null); setMessage(null); }}
            className="mt-1 rounded border border-[var(--color-border)] px-3 py-2 text-sm"
          >
            <option value="expense">지출</option>
            <option value="deposit">입금</option>
          </select>
        </label>
        <a href={`/settings/import/template/${kind}`} className="text-sm text-[var(--color-primary)] underline">
          양식 내려받기
        </a>
      </div>

      <form action={onPreview} className="flex flex-wrap items-end gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          파일 (.xls/.xlsx)
          <input type="file" name="file" accept=".xls,.xlsx" required className="mt-1 text-sm" />
        </label>
        <button type="submit" disabled={busy} className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white disabled:opacity-50">
          미리보기
        </button>
      </form>

      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
      {message && <p className="text-sm text-[var(--color-primary)]">{message}</p>}

      {preview && (
        <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm text-[var(--color-fg)]">
              반영 가능 {preview.summary.applicable}건 · 덮어씀 {preview.summary.overwrite}건 · 오류 {preview.summary.error}건(제외)
            </span>
            <button
              onClick={onCommit}
              disabled={busy || applicable === 0}
              className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              반영
            </button>
          </div>
          <div className="max-h-96 overflow-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
                  <th className="py-1">행</th><th>상태</th><th>내용</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r, idx) => (
                  <tr key={idx} className="border-b border-[var(--color-border)]">
                    <td className="py-1">{r.rowNumber}</td>
                    <td>
                      {r.status === "error"
                        ? <span className="text-[var(--color-danger)]">오류</span>
                        : r.overwrite ? "덮어씀" : r.merged ? "합산" : "정상"}
                    </td>
                    <td className="text-[var(--color-muted)]">
                      {r.status === "error" ? r.errors.join(", ") : JSON.stringify(r.data)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: 성공. `/settings/import` 라우트가 빌드 출력에 포함.

- [ ] **Step 4: 커밋**

```bash
git add "src/app/(app)/settings/import/page.tsx" "src/app/(app)/settings/import/ImportClient.tsx"
git commit -m "$(printf 'feat: add data upload screen with preview and commit\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 10: 최종 검증

**Files:**
- 없음(검증만).

- [ ] **Step 1: 전체 테스트 실행**

로컬 PG(5433)가 켜져 있어야 한다.
```bash
cd /c/dev/roi-dashboard
npm test
```
Expected: 모든 테스트 PASS (import-shared, import-expense, import-deposit, import-xlsx, import-template, data-import, nav + Phase 1 기존 테스트).

- [ ] **Step 2: 빌드 확인**

```bash
npm run build
```
Expected: 성공.

- [ ] **Step 3: (선택) 수동 확인**

`npm run dev` 후 SETTLEMENT/ADMIN 로그인:
- 사이드바 "데이터 업로드" → `/settings/import`.
- 종류 선택 → "양식 내려받기"로 .xlsx 템플릿 다운로드.
- 템플릿에 여러 고객사·여러 월 채워 업로드 → 미리보기에서 정상/덮어씀/합산/오류 배지 확인.
- "반영" → "N건 반영 완료" → 대시보드/고객사 상세에서 값 확인.
- PM 계정은 "데이터 업로드" 미노출, `/settings/import` 직접 접근 시 리다이렉트.

- [ ] **Step 4: 완료 커밋(문서 체크박스 갱신 시)**

```bash
git add docs/superpowers/plans/2026-07-10-roi-dashboard-phase2a-excel-import.md
git commit -m "$(printf 'docs: mark Phase 2A tasks complete\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Self-Review 결과

**Spec coverage (설계 문서 대비):**
- §3 아키텍처(라이브러리 격리 + 순수 파서 + withRLS 커밋 + 무상태) → Task 1·2·3·4·6·8·9.
- §4 파일 구성 → Task 1(shared)·2(expense)·3(deposit)·4(xlsx)·5(template)·6(data)·8(actions)·9(화면)·7(nav).
- §5 양식·검증(헤더검증·카테고리 13종 역매핑·행별 검증·파일 내 합산) → Task 2·3, 카테고리 표 → Task 2.
- §6 데이터 흐름(2단계 무상태, 브라우저 보관→반영, 커밋 재검증, RLS 차단) → Task 8·9·6.
- §7 미리보기 UI·에러(상태 배지·요약·부분 반영·파일 오류) → Task 9, 파서 fileError → Task 2·3.
- §8 인가·보안(SETTLEMENT+ 게이트, withRLS, revalidate, SheetJS 격리·버전 고정) → Task 4·5·8·9.
- §9 테스트(순수 파서 중심 + 어댑터 픽스처 + withRLS) → Task 1·2·3·4·5·6.
- §10 열린 결정: 메모 폐기(Task 6 create memo null·update amount만), existingKeys 전체 조회(Task 6), revalidatePath /dashboard(Task 8), SheetJS 0.20.3 고정(Task 4), 카테고리 안내 시트(Task 5).

**Placeholder scan:** 모든 코드 스텝에 실제 코드 포함. TBD/TODO 없음.

**Type consistency:** `ClientRef`/`PreviewRow`/`ImportPreview`/`ParseResult`(shared) → 파서·데이터·액션·화면에서 일관. `ExpenseCommitRow`/`DepositCommitRow` → 파서 정의, 데이터 계층·액션이 동일 형태 소비. `expenseKey`/`depositKey` → 파서(overwrite 조회)와 데이터 계층(키 집합 생성)이 동일 함수 사용. `ImportKind`("expense"|"deposit") → template·actions·화면 일관. 헤더 상수(`EXPENSE_HEADERS`/`DEPOSIT_HEADERS`) → 파서 검증과 template 생성이 동일 상수 참조.

**주의(구현 시):**
- Prisma 인터랙티브 트랜잭션 안 순차 await(병렬 금지).
- SheetJS는 `src/lib/import/xlsx.ts`에서만 import(격리 유지). 0.20.3 이상 고정.
- 지출 덮어쓰기는 amount만 update(기존 memo 보존). create 시 memo null.
