# ROI 대시보드 Phase 2A — 엑셀 업로드 임포터 설계 (지출·입금)

**작성일:** 2026-07-10
**상태:** 설계 승인 대기 → 승인 시 구현 계획(writing-plans)으로 진행
**선행:** Phase 1(기반·CRUD·대시보드, Plan 1~4) 완료. 본 문서는 phase1 설계 문서(`2026-07-08-roi-dashboard-phase1-design.md`) 로드맵의 **2단계(업로드 자동화)** 중 **엑셀 결정론 파싱 부분**을 다룬다.

---

## 1. 배경과 목표

지출·입금 데이터를 화면에서 한 건씩 수동 입력하는 대신, **정해진 엑셀 양식에 채워 업로드하면 파싱·검증·미리보기 후 일괄 반영**하는 임포터를 만든다.

**성공 기준**
- 정산담당자·관리자가 지출/입금 엑셀(.xls/.xlsx)을 업로드하면, 행별 검증 결과를 미리보기로 확인한 뒤 유효 행을 DB에 일괄 반영할 수 있다.
- 한 파일에 여러 고객사·여러 월이 섞여 있어도 각 행 단위로 올바른 `(고객사, 연, 월[, 카테고리])`에 매핑된다.
- 파싱·검증·집계 로직은 DB·라이브러리 없이 순수 함수로 단위 테스트된다.

**범위 결정(brainstorming 확정)**
- 2단계를 **2A(엑셀 임포터)** 와 **2B(PDF/AI 임포터)** 로 분해하고, **본 문서는 2A만** 다룬다.
- **2B(산출내역서 PDF→계약/과업/단가, 세금계산서→청구액)는 개발하지 않고 기존 수동 입력을 유지**한다.
- 대상 데이터: **지출**, **입금**. (계약/청구는 2A 범위 밖)

---

## 2. 범위

**포함**
- 지출 엑셀 임포터, 입금 엑셀 임포터 (공통 파이프라인 공유).
- 고정 양식(.xlsx) 템플릿 다운로드.
- 업로드 → 파싱 → 행별 검증·고객사 매칭·파일 내 집계 → 미리보기 → 사용자 확인 → 일괄 반영(덮어쓰기).
- `.xls`(BIFF)·`.xlsx`(OOXML) 양쪽 업로드 지원.

**제외 (2A 아님)**
- PDF·이미지·AI 보조 파싱 → 2B(개발 안 함, 수동 유지).
- 실적(MonthlyPerformance) 엑셀 임포트 — 범위 밖(과업 매칭 복잡, 별도 검토).
- Google Cloud Storage 등 업로드 파일 영구 저장 — 본 기능은 파싱 후 즉시 폐기(서버 무상태).
- CSV 업로드 — 양식은 엑셀 고정.

---

## 3. 아키텍처

**원칙: 라이브러리는 경계 한 곳에 격리, 도메인 로직은 순수.**

```
파일 바이트(.xls/.xlsx)
   │  src/lib/import/xlsx.ts   ← SheetJS 격리(유일한 라이브러리 사용처), 첫 시트만 읽음
   ▼
string[][]  (셀 값 2차원 배열, 문자열로 정규화)
   │  src/lib/import/expense-import.ts · deposit-import.ts   ← 순수 함수
   ▼
ImportPreview { rows[], summary }   ← 검증·매칭·집계 결과, DB 미기록
   │  (미리보기 확인 후 "반영")
   ▼
src/lib/data/import.ts   ← withRLS 트랜잭션, 기존 upsert 재사용(덮어쓰기)
```

- Phase 1의 3층 패턴(순수 함수 + `withRLS` 데이터 계층 + 화면)을 그대로 확장.
- 파싱 라이브러리(SheetJS)는 `src/lib/import/xlsx.ts` **한 파일에만** import한다. 도메인 로직(헤더 검증·셀 파싱·고객사 매칭·카테고리 매핑·집계)은 전부 `string[][]`를 입력받는 순수 함수 → DB·파일 없이 테스트.
- 커밋 계층은 기존 `upsertExpense`/`upsertBilling`/`upsertDeposit`을 재사용한다(덮어쓰기 = upsert 의미). 여러 행을 **하나의 `withRLS` 트랜잭션에서 순차 await**로 반영한다(Prisma 인터랙티브 트랜잭션 병렬 금지).
- 서버는 무상태: 미리보기 결과(파싱된 유효 행)는 **브라우저 상태로 보관**했다가 "반영" 시 서버로 다시 POST한다. 서버 임시저장·GCS 불필요.

---

## 4. 파일 구성

**신규 (순수 로직, DB 불필요)**
- `src/lib/import/xlsx.ts` — `readSheet(bytes: ArrayBuffer | Buffer): string[][]`. SheetJS로 첫 시트를 읽어 셀 값을 문자열 2차원 배열로 반환. 라이브러리 격리 지점.
- `src/lib/import/shared.ts` — 공통 헬퍼·타입:
  - `normalizeClientName(s: string): string` (trim + 연속 공백 축약 + NFC 정규화 + 소문자화 — 매칭은 대소문자 무시)
  - `parseAmount(s: string): number | null` (콤마·"원"·공백 제거 후 정수, 실패 시 null)
  - `parseYear`, `parseMonth`
  - `type RowStatus = "ok" | "overwrite" | "merged" | "error"`
  - `type ClientRef = { id: string; name: string }`
  - `type PreviewRow<T> = { rowNumber: number; status: RowStatus; errors: string[]; data: T | null; overwrote?: boolean }`
  - `type ImportPreview<T> = { rows: PreviewRow<T>[]; summary: { applicable: number; overwrite: number; error: number } }`
- `src/lib/import/expense-import.ts` — `parseExpenseRows(rows: string[][], clients: ClientRef[], existingKeys: Set<string>): ImportPreview<ExpenseCommitRow>`.
- `src/lib/import/deposit-import.ts` — `parseDepositRows(rows: string[][], clients: ClientRef[], existingKeys: Set<string>): ImportPreview<DepositCommitRow>`.

**신규 (데이터 계층, withRLS RLS 테스트)**
- `src/lib/data/import.ts`
  - `getClientRefs(ctx): Promise<ClientRef[]>` — 매칭용 고객사 목록(RLS 범위).
  - `getExistingExpenseKeys(ctx, ...): Promise<Set<string>>` / `getExistingDepositKeys(ctx, ...): Promise<Set<string>>` — 덮어쓰기 배지 판정용 기존 키(지출·입금 각각).
  - `commitExpenseImport(ctx, rows: ExpenseCommitRow[]): Promise<{ applied: number }>`
  - `commitDepositImport(ctx, rows: DepositCommitRow[]): Promise<{ applied: number }>`

**신규 (화면·라우트)**
- `src/app/(app)/settings/import/page.tsx` — 업로드 화면(서버 컴포넌트, 인가 게이트).
- `src/app/(app)/settings/import/ImportClient.tsx` — 종류 선택(지출/입금) + 파일 선택 + 미리보기 표 + 반영 버튼(클라이언트 컴포넌트).
- `src/app/(app)/settings/import/actions.ts` — `previewImport`(FormData: kind+file → ImportPreview), `commitImport`(kind + 유효 행 → 반영 결과).
- `src/app/(app)/settings/import/template/[kind]/route.ts` — 종류별 빈 템플릿 .xlsx 다운로드(헤더 상수로 생성).

**수정**
- `src/lib/shell/nav.ts` — SETTLEMENT/ADMIN 메뉴에 `{ href: "/settings/import", label: "데이터 업로드" }` 추가.

**테스트**
- `test/import-expense.test.ts`, `test/import-deposit.test.ts` (순수, `string[][]` 픽스처)
- `test/import-shared.test.ts` (정규화·파싱 헬퍼)
- `test/import-xlsx.test.ts` (샘플 .xls/.xlsx 바이너리 픽스처 → `string[][]`)
- `test/data-import.test.ts` (withRLS: 덮어쓰기·RLS 범위·대량 반영)
- `test/nav.test.ts` (수정)

---

## 5. 양식(템플릿)과 검증 규칙

### 5.1 열 구성

**지출:** `고객사 | 연 | 월 | 카테고리 | 금액 | 메모(선택)`
**입금:** `고객사 | 연 | 월 | 금액`

- 첫 행은 헤더. 헤더 문자열은 코드 상수와 정확히 일치해야 한다(공백 trim 후 비교). 불일치·누락 시 **파일 전체 거부**.
- 템플릿은 `template/[kind]` 라우트가 헤더 상수로 생성해 다운로드 → 헤더 단일 소스 유지. (지출 템플릿에는 유효 카테고리 13종을 안내하는 두 번째 시트/주석 포함.)

### 5.2 카테고리 매핑(지출)

기존 `expenseCategoryLabel`(src/lib/labels.ts)의 13종 한글 라벨을 그대로 사용하고, 역매핑 상수(라벨→`ExpenseCategory`)를 `import/shared.ts`에 둔다.

| 라벨 | enum | 라벨 | enum |
|---|---|---|---|
| 법인카드 | CORPORATE_CARD | 홍보비(이벤트) | PROMOTION_EVENT |
| 개인카드 | PERSONAL_CARD | 운영비(교통비) | OPS_TRANSPORT |
| 인건비(상담사) | LABOR_COUNSELOR | 운영비(숙박비) | OPS_LODGING |
| 인건비(강사) | LABOR_INSTRUCTOR | 운영비(식비) | OPS_FOOD |
| 교육&프로그램 진행비 | EDUCATION_PROGRAM | 운영비(회의비) | OPS_MEETING |
| 홍보비(오프라인) | PROMOTION_OFFLINE | 검사지 구매 | TEST_MATERIAL |
| | | 일반관리(기타) | GENERAL_ETC |

### 5.3 행별 검증

| 항목 | 규칙 | 위반 시 |
|---|---|---|
| 고객사 | `normalizeClientName` 후 기존 고객사명과 매칭(대소문자 무시) | 오류 "미등록 고객사: {값}" |
| 연 | 정수 2000–2100 | 오류 "연도 범위 오류" |
| 월 | 정수 1–12 | 오류 "월 범위 오류" |
| 금액 | 콤마·"원"·공백 제거 후 정수 ≥ 0 | 오류 "금액 형식 오류" |
| 카테고리(지출) | 13종 라벨 중 하나 → enum | 오류 "알 수 없는 카테고리: {값}" |
| 필수 빈 셀 | 위 항목의 값이 비어 있으면 | 오류 "필수값 누락" |
| 완전 빈 행 | 모든 셀이 빈 행 | 조용히 스킵(카운트 제외) |

### 5.4 파일 내 집계

- 지출: 같은 `(고객사, 연, 월, 카테고리)` 행이 여러 개면 **금액 합산**, 상태 `merged`.
- 입금: 같은 `(고객사, 연, 월)` 행이 여러 개면 **금액 합산**, 상태 `merged`.
- 메모(지출)는 합산 시 정책상 **버린다**(월 카테고리 단위 저장이라 대표 메모가 모호). 필요 시 구현 계획에서 "세미콜론 연결" 등으로 조정 가능하나 기본은 폐기.

---

## 6. 데이터 흐름 (2단계, 서버 무상태)

1. **미리보기** — 사용자가 종류(지출/입금) 선택 + 파일 선택 → `previewImport(FormData)`.
   - 서버: `readSheet(bytes)` → `string[][]` → 순수 파서(현재 고객사 목록·기존 키 주입) → `ImportPreview` 반환. **DB 미기록.**
2. UI가 미리보기 표 렌더(§7). 파싱된 유효 행(`data` 있는 행)을 **브라우저 상태로 보관**.
3. **반영** — "반영" 클릭 → 보관 중인 유효 행을 `commitImport(kind, rows)`에 전달.
   - 서버: `withRLS` 트랜잭션에서 행별 upsert(덮어쓰기), 순차 await. 반영 건수 반환.
   - 방어: 커밋 시 각 행의 `clientId` 접근 가능 여부를 RLS가 물리적으로 강제(불가 고객사 기록 차단). 값 재검증(금액 ≥ 0, 연/월 범위)도 커밋 계층에서 한 번 더 수행.

**덮어쓰기 판정(미리보기 표시용):** 미리보기 시 기존 키 집합(`existingKeys`)과 대조해 이미 값이 있는 셀은 상태 `overwrite`로 표시(사용자 경고 목적). 실제 반영은 upsert라 항상 대체된다.

---

## 7. 미리보기 UI & 에러 처리

- 미리보기 표: 각 행에 상태 배지 — `정상` / `덮어씀`(기존값 존재) / `합산`(파일 내 중복 합산) / `오류(사유)`.
- 상단 요약: "반영 가능 N건 · 덮어씀 K건 · 오류 M건(제외)".
- **오류 행은 반영에서 제외**(부분 반영 허용). 사용자는 파일 수정 후 재업로드.
- 반영 가능 행이 0이면 "반영" 버튼 비활성.
- 파일 오류:
  - 헤더 불일치/누락 → 파일 전체 거부, "양식이 올바르지 않습니다. 템플릿을 사용하세요." + 기대 헤더 표기.
  - 데이터 행 없음 → "데이터가 없습니다."
  - 손상 파일·비엑셀 → `readSheet` 예외 → "파일을 읽을 수 없습니다(.xls/.xlsx만 지원)."
- 반영 성공 → "N건 반영 완료" 토스트/메시지. 대시보드·상세 값 즉시 반영(조회는 실시간 집계).

---

## 8. 인가·보안

- 화면·두 액션·템플릿 라우트 모두 `requireUser()` 후 `hasAtLeast(user.role, "SETTLEMENT")` 게이트. 미달 시 `notFound()`(기존 settings 패턴).
- 모든 DB 접근은 `withRLS` 경유. SETTLEMENT/ADMIN은 전 고객사 조회 가능하므로 매칭·반영 범위에 실질 제약은 없으나, RLS는 여전히 물리 방어선으로 유지.
- 조회 전용 아님(쓰기 기능) — 반영 후 관련 경로 `revalidatePath` 처리(대시보드·고객사 상세). 구현 계획에서 대상 경로 확정.
- 업로드 파일은 파싱 후 메모리에서 폐기(영구 저장 없음).

### 새 의존성
- `xlsx`(SheetJS Community) — `.xls`/`.xlsx`를 한 라이브러리로 읽는 유일한 주류 선택지라 도입 불가피(Phase 1~4의 "신규 런타임 의존성 없음"을 처음 깨는 지점).
- 보안: **패치된 버전으로 고정**(prototype pollution 등 과거 이슈 회피), **읽기+템플릿 쓰기 전용**, `src/lib/import/xlsx.ts`에만 격리. 업로더가 내부 정산/관리자로 한정돼 신뢰 경계 안. (npm 배포 버전이 구버전이면 SheetJS 공식 배포 채널의 패치 버전 핀 고려 — 구현 계획에서 버전 확정.)

---

## 9. 테스트 전략

- **순수 파서(핵심, 대부분):** `string[][]` 픽스처로 — 헤더 검증(정상·누락·순서), 고객사 매칭(정상·정규화·미매칭), 연/월/금액/카테고리 각 오류, 파일 내 집계(지출·입금), 빈 행 스킵, 요약 카운트. DB 불필요.
- **shared 헬퍼:** 정규화·금액 파싱 경계값.
- **어댑터 `xlsx.ts`:** 커밋된 소형 `.xlsx`·`.xls` 바이너리 픽스처(`test/fixtures/`) → 기대 `string[][]`.
- **커밋 계층 `data-import`:** withRLS RLS 테스트 — 덮어쓰기(재반영 멱등), 여러 고객사·여러 월 대량 반영, RLS 범위(접근 불가 고객사 행 차단).
- **nav:** SETTLEMENT/ADMIN 메뉴에 데이터 업로드 노출, PM 미노출.
- 실행: `npm test`(vitest, 로컬 PG 5433 필요), `npm run build`.

---

## 10. 열린 결정(구현 계획에서 확정)

- 지출 합산 시 메모 처리(기본 폐기 vs 연결) — 기본 폐기로 진행.
- `existingKeys` 조회 범위(전체 vs 업로드에 등장하는 연·월만) — 성능상 등장 연·월로 좁힐지.
- 반영 후 `revalidatePath` 대상 경로 확정.
- SheetJS 정확한 버전·설치 채널.
- 템플릿의 카테고리 안내 방식(별도 시트 vs 주석).
