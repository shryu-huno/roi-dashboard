# 지급요청 재업로드 지급일 파싱 유연화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 지급요청 엑셀 재업로드 시 `지급일` 셀이 `YYYY-MM-DD` 정확한 텍스트가 아니어도(구분자 `.`/`/` 허용, 연도 생략 시 올해로 채움, 실제 Excel 날짜 타입 셀도 인식) 반영되도록 파싱 범위를 넓힌다.

**Architecture:** 두 지점만 수정한다. ① `parseXlsxToRows`(엑셀 → 문자열 배열 변환)에서 셀이 실제 Date 타입이면 표시 서식(`.text`)이 아니라 셀의 UTC 연/월/일 값을 직접 `YYYY-MM-DD`로 정규화. ② `parseDateCell`(문자열 → Date 변환)에서 구분자 종류와 연도 생략을 허용하는 정규화 단계를 기존 검증 로직 앞에 추가. 두 지점 모두 최종적으로는 기존 `YYYY-MM-DD` 문자열/달력 유효성 검증 경로로 합류한다.

**Tech Stack:** TypeScript, exceljs, Vitest.

## Global Constraints

- 지급일은 KST 달력일 기준으로 표시/파싱하고 DB에는 해당 날짜의 UTC 자정(00:00:00Z)으로 저장한다 — 기존 `src/lib/data/payment-request-upload.ts` 상단 주석에 이미 명시된 규약이며, 이번 변경도 반드시 지켜야 한다.
- 일-월 순서 표기(`31/7` 등 DD/MM), 한글 혼합 표기(`2026년 8월 15일`), 2자리 연도(`26-8-15`)는 이번 스펙 범위 밖 — 계속 거부되어야 한다.
- 연도 생략 시 채우는 연도는 "파싱 시점의 KST 기준 올해"다.
- 기존 에러 메시지 문구("지급일 형식이 올바르지 않습니다(YYYY-MM-DD)" 등)는 변경하지 않는다.

---

### Task 1: Date 타입 셀을 ISO 문자열로 정규화 (`parseXlsxToRows`)

**Files:**
- Modify: `src/app/(app)/expenses/payees/xlsx.ts:36-53` (`parseXlsxToRows` 함수)
- Test: `test/payee-xlsx.test.ts`

**Interfaces:**
- Consumes: 없음 (독립 작업)
- Produces: `parseXlsxToRows(buf): Promise<string[][]>`의 동작 변경만 — 시그니처는 그대로. Task 2는 이 함수가 반환한 `string[][]`를 그대로 소비하므로 별도 인터페이스 의존 없음.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/payee-xlsx.test.ts`의 `describe("payee xlsx 유틸", ...)` 블록 안에 아래 테스트를 추가한다(기존 `it` 블록들 사이 아무 곳):

```ts
  it("실제 Date 타입 셀은 표시 서식과 무관하게 UTC 기준 YYYY-MM-DD로 정규화된다", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("s");
    ws.addRow(["헤더"]);
    const row = ws.addRow([new Date(Date.UTC(2026, 7, 15))]); // 8월 15일(UTC)
    row.getCell(1).numFmt = "m/d/yyyy"; // 표시 서식은 다르게 설정
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const rows = await parseXlsxToRows(buf);
    expect(rows[1][0]).toBe("2026-08-15");
  });
```

**주의:** 이 파일 상단 import는 이미 `parseXlsxToRows`를 가져오고 있으므로 추가 import는 필요 없다(테스트 내부에서 `exceljs`를 동적 import하는 기존 패턴을 그대로 따른다).

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx vitest run test/payee-xlsx.test.ts -t "Date 타입 셀"`
Expected: FAIL — `rows[1][0]`이 `"2026-08-15"`가 아니라 `numFmt`(`m/d/yyyy`)로 렌더링된 문자열(예: `"8/15/2026"`)로 나와서 불일치.

- [ ] **Step 3: 최소 구현**

`src/app/(app)/expenses/payees/xlsx.ts`의 `parseXlsxToRows` 함수(현재 36-53줄)를 아래로 교체한다:

```ts
// Date 타입 셀은 화면 표시 서식(로캘/포맷)에 좌우되지 않도록 UTC 연/월/일을 직접 조합한다.
// exceljs는 Excel 날짜 직렬값을 타임존 없이 그대로 UTC Date로 해석하므로, UTC 컴포넌트가
// 곧 사용자가 입력한 달력일과 일치한다.
function formatUtcDateAsIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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
      const cell = row.getCell(c);
      const text =
        cell.type === ExcelJS.ValueType.Date && cell.value instanceof Date
          ? formatUtcDateAsIsoDate(cell.value)
          : (cell.text ?? "").toString();
      cells.push(text);
    }
    rows.push(cells);
  }
  return rows;
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npx vitest run test/payee-xlsx.test.ts`
Expected: PASS — 전체 파일(기존 테스트 포함) 통과.

- [ ] **Step 5: 커밋**

```bash
git add src/app/\(app\)/expenses/payees/xlsx.ts test/payee-xlsx.test.ts
git commit -m "fix(payment-request): 재업로드 시 Date 타입 셀을 표시서식과 무관하게 UTC 기준으로 정규화"
```

---

### Task 2: 지급일 텍스트 파싱 확장 (`parseDateCell`)

**Files:**
- Modify: `src/lib/data/payment-request-upload.ts:22-43` (`parseDateCell` 함수)
- Test: `test/payment-request-upload.test.ts`

**Interfaces:**
- Consumes: 없음 (Task 1과 독립 — `buildPaymentRequestUpdatesFromRows`는 이미 문자열이 된 셀 값을 받으므로 Task 1의 정규화 결과와 이번 정규화가 함께 적용되지만 코드 의존성은 없음)
- Produces: `buildPaymentRequestUpdatesFromRows(rows: string[][]): PaymentRequestUpdateBuildResult` 시그니처는 그대로 유지.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/payment-request-upload.test.ts`에서 기존 테스트 하나를 수정하고, 새 테스트들을 추가한다.

먼저 기존 61-65줄의 테스트(`it("지급일 형식이 YYYY-MM-DD가 아니면 오류", ...)`)를 아래로 교체(이제 `2026/08/05`는 유효하므로, 여전히 거부되어야 하는 입력으로 바꾼다):

```ts
  it("지급일이 한글 혼합 표기면 오류", () => {
    const result = buildPaymentRequestUpdatesFromRows([HEADER, ["1", "2026년08월05일", "지급완료"]]);
    expect(result.updates).toEqual([]);
    expect(result.errors[0].message).toContain("지급일 형식");
  });
```

그리고 `describe` 블록을 닫는 마지막 127줄 `});` 바로 앞(마지막 테스트인 "2026-11-31(11월 31일)은 거부한다" 다음)에 아래 테스트들을 추가한다:

```ts
  it("지급일 구분자로 .과 /도 허용한다", () => {
    const result = buildPaymentRequestUpdatesFromRows([
      HEADER,
      ["1", "2026.08.05", "지급완료"],
      ["2", "2026/08/05", "지급완료"],
    ]);
    expect(result.errors).toEqual([]);
    expect(result.updates).toEqual([
      { row: 2, seqNo: 1, payDate: new Date("2026-08-05T00:00:00.000Z"), status: "COMPLETED" },
      { row: 3, seqNo: 2, payDate: new Date("2026-08-05T00:00:00.000Z"), status: "COMPLETED" },
    ]);
  });

  it("지급일에 월/일 앞자리 0을 생략해도 허용한다", () => {
    const result = buildPaymentRequestUpdatesFromRows([HEADER, ["1", "2026-8-5", "지급완료"]]);
    expect(result.errors).toEqual([]);
    expect(result.updates).toEqual([
      { row: 2, seqNo: 1, payDate: new Date("2026-08-05T00:00:00.000Z"), status: "COMPLETED" },
    ]);
  });

  it("지급일에 연도를 생략하면 파싱 시점의 KST 올해로 채운다", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T00:00:00.000Z"));
    try {
      const result = buildPaymentRequestUpdatesFromRows([
        HEADER,
        ["1", "8/15", "지급완료"],
        ["2", "8.15", "지급완료"],
        ["3", "8-15", "지급완료"],
      ]);
      expect(result.errors).toEqual([]);
      expect(result.updates).toEqual([
        { row: 2, seqNo: 1, payDate: new Date("2026-08-15T00:00:00.000Z"), status: "COMPLETED" },
        { row: 3, seqNo: 2, payDate: new Date("2026-08-15T00:00:00.000Z"), status: "COMPLETED" },
        { row: 4, seqNo: 3, payDate: new Date("2026-08-15T00:00:00.000Z"), status: "COMPLETED" },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("지급일이 일-월 순서(DD/MM)면 오류", () => {
    const result = buildPaymentRequestUpdatesFromRows([HEADER, ["1", "31/7", "지급완료"]]);
    expect(result.updates).toEqual([]);
    expect(result.errors[0].message).toContain("지급일 형식");
  });

  it("지급일이 2자리 연도면 오류", () => {
    const result = buildPaymentRequestUpdatesFromRows([HEADER, ["1", "26-8-15", "지급완료"]]);
    expect(result.updates).toEqual([]);
    expect(result.errors[0].message).toContain("지급일 형식");
  });
```

파일 최상단 import도 `vi`를 추가하도록 수정한다:

```ts
import { describe, it, expect, vi } from "vitest";
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx vitest run test/payment-request-upload.test.ts`
Expected: FAIL — 새로 추가한 구분자(`.`/`/`)·앞자리 0 생략·연도 생략 케이스들이 현재 정규식(`^\d{4}-\d{2}-\d{2}$`)을 통과하지 못해 오류로 처리됨.

- [ ] **Step 3: 최소 구현**

`src/lib/data/payment-request-upload.ts`의 22-43줄(`parseDateCell` 함수와 그 위 주석)을 아래로 교체한다:

```ts
const FULL_DATE = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/;
const MONTH_DAY = /^(\d{1,2})[-./](\d{1,2})$/;

// 파싱 시점의 KST 기준 올해 — 연도가 생략된 지급일("8/15" 등)을 보완할 때 사용.
function currentKstYear(): number {
  return Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric" }).format(new Date()));
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// 구분자(-, ., /)와 앞자리 0 생략을 허용하고, 연도가 생략되면 올해로 채워 "YYYY-MM-DD"로 정규화한다.
// 일-월 순서(DD/MM), 2자리 연도, 한글 혼합 표기는 의도적으로 지원하지 않는다(모호성 위험).
function normalizeDateCell(value: string): string | undefined {
  const full = FULL_DATE.exec(value);
  if (full) {
    const [, y, m, d] = full;
    return `${y}-${pad2(Number(m))}-${pad2(Number(d))}`;
  }
  const monthDay = MONTH_DAY.exec(value);
  if (monthDay) {
    const [, m, d] = monthDay;
    return `${currentKstYear()}-${pad2(Number(m))}-${pad2(Number(d))}`;
  }
  return undefined;
}

// <input type="date">와 동일하게 "YYYY-MM-DD"(및 위 정규화로 흡수되는 변형)만 허용.
// 달력 유효성 검증: 예를 들어 "2026-02-30"은 2월 30일이 존재하지 않으므로 거부.
// 지급일은 KST 달력일 기준으로 표시/파싱한다 — DB에는 그 날짜의 UTC 자정(00:00:00Z)으로
// 저장된다. 다른 곳에서 payDate를 쓸 때도 이 규약을 맞춰야 재업로드 시 날짜가 밀리지 않는다.
function parseDateCell(value: string): Date | undefined {
  const normalized = normalizeDateCell(value);
  if (!normalized) return undefined;
  const d = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return undefined;

  // Date 생성자는 범위를 벗어난 날짜를 자동으로 정규화한다.
  // 예: new Date("2026-02-30T...") → 2026-03-02
  // 따라서 입력 컴포넌트와 파싱된 Date의 UTC 컴포넌트가 일치하는지 확인해야 한다.
  const [inputYear, inputMonth, inputDay] = normalized.split("-").map(Number);
  if (
    d.getUTCFullYear() !== inputYear ||
    d.getUTCMonth() + 1 !== inputMonth ||
    d.getUTCDate() !== inputDay
  ) {
    return undefined;
  }
  return d;
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npx vitest run test/payment-request-upload.test.ts`
Expected: PASS — 전체 파일(기존 + 신규 테스트) 통과.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/data/payment-request-upload.ts test/payment-request-upload.test.ts
git commit -m "feat(payment-request): 재업로드 지급일 파싱에 구분자 종류/앞자리0생략/연도생략 허용"
```

---

### Task 3: 전체 회귀 확인

**Files:** 없음(신규/수정 없음, 검증만)

**Interfaces:** 없음

- [ ] **Step 1: 관련 테스트 스위트 전체 실행**

Run: `npx vitest run test/payee-xlsx.test.ts test/payment-request-upload.test.ts test/payment-request-xlsx.test.ts test/data-payment-requests.test.ts`
Expected: PASS — Task 1/2에서 건드리지 않은 인접 테스트 파일들(엑셀 헤더 왕복, 데이터 계층)도 회귀 없이 통과.

- [ ] **Step 2: 프로젝트 전체 테스트 실행**

Run: `npx vitest run`
Expected: PASS — 전체 스위트 그린.

- [ ] **Step 3: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

(이 태스크는 코드 변경이 없으므로 커밋하지 않는다.)
