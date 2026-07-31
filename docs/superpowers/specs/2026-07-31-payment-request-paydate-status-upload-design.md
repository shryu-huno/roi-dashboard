# 지급요청 엑셀 재업로드(지급일/지급여부 반영) 설계

## 배경

방금 구현한 지급요청 엑셀 다운로드(`docs/superpowers/specs/2026-07-31-payment-request-export-design.md`)에 이어, 정산담당자/관리자가 다운로드한 엑셀에 `지급일`/`지급여부`만 채워 재업로드하면 해당 값만 DB에 반영되는 기능을 추가한다. 화면에는 이미 이 용도로 만들어진 스텁 모달(`PaymentRequestExcelUploadModal.tsx`, "다운로드한 엑셀에 지급일/지급여부만 채워서 업로드하면 해당 값만 반영됩니다")이 있으나 `handleUpload`가 `alert("추후 구현 예정입니다.")`뿐이다.

## 현재 상태 (조사 결과)

- **"번호"는 DB에 저장된 값이 아니다.** 목록 화면(`PaymentRequestListPanel.tsx:178`)의 "No"는 `(page-1)×50 + 행순서`, 방금 만든 엑셀의 "번호"(`payment-request/xlsx.ts`)는 `i+1` — 둘 다 조회 시점의 위치를 계산한 값이며, 정렬/필터/페이지가 다르면 같은 건도 번호가 달라진다. 재업로드 매칭 키로 쓸 수 없다.
- `Payee`에는 등록 시 DB 시퀀스로 채번되고 이후 고정되는 `keyId`(a001/b001)가 있어 안전한 매칭 키로 쓰이지만, `PaymentRequest`에는 대응하는 필드가 없다.
- 이 저장소는 `npx prisma migrate dev`가 `_prisma_migrations` 테이블의 RLS 때문에 shadow DB 복제 단계에서 100% 재현 가능하게 깨진다(P3006/P1014). 새 마이그레이션은 `npx prisma migrate diff --from-schema-datamodel <변경 전 schema.prisma 백업> --to-schema-datamodel prisma/schema.prisma --script`로 SQL을 뽑아 `prisma/migrations/<timestamp>_<name>/migration.sql`에 손으로 배치한 뒤 `npx prisma migrate deploy`로 적용해야 한다(`migrate dev` 금지).
- `지급여부`(`PaymentRequestStatus`)는 DB 기본값이 `PREPARING`이라 항상 값이 있고, `지급일`(`payDate`)은 nullable이라 미처리 건은 다운로드 시점에 공란이다. 정산담당자는 보통 이번에 처리한 일부 건만 채워 재업로드하고 나머지는 그대로 두므로, 검증 규칙은 "손대지 않은 행"까지 오류로 걸리지 않아야 한다.
- 지급 리스트 등록 서식(`payees/xlsx.ts`의 `buildTemplateXlsxBuffer`)은 청구방식 컬럼에 드롭다운 데이터 유효성 검사(`dataValidations.add(..., {type:"list", formulae:[...]})`)를 이미 쓰고 있다 — 같은 패턴을 지급여부 컬럼에 재사용한다.
- 지급 리스트 업로드(`payees/build-inputs.ts`)는 헤더를 이름으로 찾아 컬럼 인덱스를 매핑하고, 행마다 zod로 검증해 `{row, message}` 오류 배열과 유효 입력 배열을 함께 반환하는 패턴을 쓴다(`uploadPayeesAction`이 이를 소비해 부분 성공 + 오류 목록 UX를 만듦). 이번 기능도 동일 패턴을 따른다.
- `FileDropzone`은 `name`/`accept`/`hint` props만 받는 범용 컴포넌트라, 이번 업로드도 그대로 재사용 가능(accept를 `.xlsx`로 좁히기만 하면 됨).

## 결정 사항

- **`seqNo` 추가**: `PaymentRequest`에 `seqNo Int @unique @default(autoincrement())`를 추가해 등록 시 한 번 채번되고 이후 절대 바뀌지 않는 값으로 만든다. 기존 행은 Prisma의 기본 백필(임의 스캔 순서) 대신 `requestedAt` 오름차순으로 명시적으로 채번한다(`ROW_NUMBER() OVER (ORDER BY "requestedAt", id)`).
- **목록 화면 "No" 변경**: 위치 계산값 대신 `seqNo`를 표시한다. `PaymentRequestRow`/`listPaymentRequests`/`listPaymentRequestsForExport`에 `seqNo: number` 필드를 추가.
- **엑셀 "번호"→"No"**: 헤더 텍스트를 "No"로 바꾸고 값도 `i+1`(순번) 대신 `r.seqNo`로 교체.
- **지급일/지급여부 컬럼 추가**: `상세내역` 뒤(19, 20번째 컬럼)에 추가, 총 20열. `지급일`은 `YYYY-MM-DD` 텍스트(공란 가능), `지급여부`는 한글 라벨("지급준비"/"지급완료") + 드롭다운 데이터 유효성 검사.
- **재업로드 시 컬럼 인식**: 헤더 행에서 "No", "지급일", "지급여부" 3개만 이름으로 찾아 읽는다. 나머지 17개 컬럼(사업자명 등)은 값이 바뀌어 있어도 무시한다(반영 대상이 아님).
- **매칭**: `No` 셀의 정수값을 `seqNo`로 조회해 대상 `PaymentRequest`를 찾는다. 찾지 못하면 그 행은 오류.
- **검증 규칙**:
  - `지급여부`는 "지급준비"/"지급완료" 중 하나만 허용(그 외 값·공란은 오류).
  - `지급일`은 해당 행의 `지급여부`가 "지급완료"인 경우에만 필수(공란이면 오류, 형식은 `YYYY-MM-DD`만 허용). `지급여부`가 "지급준비"로 남는 행은 `지급일` 공란을 허용하고, 값이 있으면 그대로 반영한다.
  - `지급일`을 공란으로 재업로드해도(그 행이 "지급준비"로 유지되는 한) 기존 값을 지우는 것으로 처리한다(별도 "유지" 옵션 없음 — 업로드된 값을 그대로 덮어씀. 공란=null).
- **반영 방식**: 부분 반영 — 유효성 검사를 통과한 행만 DB에 반영하고, 오류 행은 반영하지 않은 채 "N행: 사유" 형태로 안내한다(지급 리스트 업로드와 동일한 부분성공 UX, all-or-nothing 아님).
- **업로드 파일 형식**: `.xlsx`만 지원(기존 스텁의 `.xlsx,.xls,.csv` 힌트에서 축소). 이 업로드는 우리가 만든 엑셀을 그대로 재업로드하는 용도라 CSV/XLS 지원 시나리오가 없다.
- **권한**: 기존과 동일하게 `ADMIN`/`SETTLEMENT`만(라우트가 아닌 서버 액션이므로 `requireRole("SETTLEMENT")`를 액션 안에서 직접 호출).
- **RLS와의 관계**: 매칭된 건에 대한 UPDATE는 `withRLS`로 감싸 기존 RLS 정책(정산담당자/관리자는 전체, PM은 자기 건만 — 단 이 기능 자체는 ADMIN/SETTLEMENT 전용이라 실질적으로 전체 UPDATE)을 그대로 적용받는다. 소프트 삭제된(`deletedAt` not null) 건은 매칭 대상에서 제외 — 삭제된 건의 `No`가 업로드 파일에 남아있으면 "찾을 수 없음" 오류로 처리한다.

## 아키텍처 / 데이터 흐름

```
1) 마이그레이션
   schema.prisma(+seqNo) --diff--> migration.sql(+백필 손질) --deploy--> DB

2) 화면/엑셀 반영
   listPaymentRequests / listPaymentRequestsForExport  (seqNo 필드 추가)
     |                              |
   PaymentRequestListPanel "No"   payment-request/xlsx.ts "No"+지급일+지급여부 컬럼

3) 재업로드
   [PaymentRequestExcelUploadModal] --submit(file)--> uploadPaymentRequestUpdatesAction (서버 액션, 신규)
                                                              |
                                                requireRole("SETTLEMENT")
                                                              |
                                          parseXlsxToRows(file) → buildPaymentRequestUpdatesFromRows(rows)  (신규)
                                                              |
                                          { updates: {seqNo, payDate, status}[], errors: {row, message}[] }
                                                              |
                                          updatePaymentRequestsBulk(ctx, updates)  (신규, 데이터 계층)
                                                              |
                                          부분 반영 결과 { updated, errors } → 모달에 표시
```

## 변경 파일

### `prisma/schema.prisma` + 신규 마이그레이션

- `PaymentRequest` 모델에 `seqNo Int @unique @default(autoincrement())` 필드 추가(예: `id` 다음 줄).
- 마이그레이션 생성 절차(이 저장소 전용 워크어라운드):
  1. `prisma/schema.prisma`를 임시 위치에 백업.
  2. 스키마에 `seqNo` 필드 추가.
  3. `npx prisma migrate diff --from-schema-datamodel <백업 경로> --to-schema-datamodel prisma/schema.prisma --script > /tmp/diff.sql`로 초안 SQL 생성.
  4. 초안은 Prisma가 기본 제공하는 방식(각 기존 행에 대해 `nextval()`을 임의 순서로 호출)이므로, 아래처럼 `requestedAt` 순서로 명시적으로 채번하는 로직으로 손질해 `prisma/migrations/<timestamp>_add_payment_request_seq_no/migration.sql`에 저장:

```sql
CREATE SEQUENCE "PaymentRequest_seqNo_seq";
ALTER TABLE "PaymentRequest" ADD COLUMN "seqNo" INTEGER;

UPDATE "PaymentRequest" pr
SET "seqNo" = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "requestedAt", id) AS rn
  FROM "PaymentRequest"
) sub
WHERE pr.id = sub.id;

SELECT setval('"PaymentRequest_seqNo_seq"', COALESCE((SELECT MAX("seqNo") FROM "PaymentRequest"), 0) + 1, false);

ALTER TABLE "PaymentRequest" ALTER COLUMN "seqNo" SET NOT NULL;
ALTER TABLE "PaymentRequest" ALTER COLUMN "seqNo" SET DEFAULT nextval('"PaymentRequest_seqNo_seq"');
ALTER SEQUENCE "PaymentRequest_seqNo_seq" OWNED BY "PaymentRequest"."seqNo";
CREATE UNIQUE INDEX "PaymentRequest_seqNo_key" ON "PaymentRequest"("seqNo");
```

  5. `npx prisma migrate deploy` (절대 `migrate dev` 아님) → `npx prisma migrate status`로 "up to date" 확인.
  6. `npx prisma generate`로 Prisma Client 타입 갱신(`seqNo` 필드 인식되도록).

### `src/lib/data/payment-requests.ts`

- `PaymentRequestRow`에 `seqNo: number` 필드 추가, `listPaymentRequests` 매핑에 `seqNo: r.seqNo` 추가.
- `PaymentRequestExportRow`에 `seqNo: number`, `payDate: Date | null`, `status: PaymentRequestStatus` 3개 필드 추가(기존엔 `payDate`/`status`가 없었다 — 지급일/지급여부 컬럼을 엑셀에 내보내려면 필요), `listPaymentRequestsForExport` 매핑에 세 필드 추가.
- 신규 함수 `updatePaymentRequestsBulk(ctx, updates: {seqNo:number; payDate:Date|null; status:PaymentRequestStatus}[])`:
  - `seqNo` in updates 목록으로 대상 조회(`deletedAt: null`) → 존재하지 않는 `seqNo`는 결과에서 오류로 보고.
  - 존재하는 건만 `payDate`/`status` 업데이트(`withRLS`로 감싸 RLS 적용).
  - 반환: `{ updated: number; notFound: number[] }`(찾지 못한 seqNo 목록 — 호출부인 서버 액션이 원래 행 번호와 다시 매핑해 사용자 메시지를 만듦).

### `src/app/(app)/expenses/payment-request/xlsx.ts`

- `EXPORT_HEADERS`에 `"지급일"`, `"지급여부"` 추가(상세내역 뒤, 총 20열), `"번호"` → `"No"`로 변경.
- `buildPaymentRequestExportXlsxBuffer`의 데이터 행 매핑: `i+1` → `r.seqNo`, 끝에 지급일(KST `YYYY-MM-DD` 문자열, `r.payDate`가 null이면 빈 문자열 — 목록 화면 `dateStr()`와 동일한 포맷), `paymentRequestStatusLabel(r.status)` 추가.
- 지급여부 컬럼에 드롭다운 데이터 유효성 검사 추가(`payees/xlsx.ts`의 `dataValidations.add(..., {type:"list", formulae:[\`"지급준비,지급완료"\`]})` 패턴 재사용, `colLetter` 헬퍼 필요 — 이 파일에도 복제).
- 지급일 컬럼은 텍스트 서식(`numFmt:"@"`)으로 공란/형식 손실 방지(사업자번호·계좌번호와 동일 처리).

### `src/lib/data/payment-request-upload.ts` (신규)

- `buildPaymentRequestUpdatesFromRows(rows: string[][]): { updates: {seqNo:number; payDate:Date|null; status:PaymentRequestStatus}[]; errors: {row:number; message:string}[] }`
  - 헤더 행에서 "No"/"지급일"/"지급여부" 컬럼 인덱스를 이름으로 찾음(누락 시 전체 오류로 즉시 반환, `build-inputs.ts`의 헤더 누락 처리와 동일 패턴).
  - 행마다: 빈 행 skip, `No` 파싱 실패(정수 아님) → 오류, `지급여부` 값이 "지급준비"/"지급완료"가 아니면 오류, `지급여부`="지급완료"인데 `지급일`이 공란/형식(`YYYY-MM-DD`) 오류면 오류, 그 외엔 `updates`에 추가.

### `src/app/(app)/expenses/payment-request/actions.ts` (신규, `"use server"`)

- `uploadPaymentRequestUpdatesAction(_prev, formData)`:
  - `requireRole("SETTLEMENT")` → `getRlsContext`.
  - 파일 확장자 `.xlsx` 확인(그 외 확장자는 에러 메시지로 반환).
  - `parseXlsxToRows`(payees/xlsx.ts에서 import, 기존 함수 재사용) → `buildPaymentRequestUpdatesFromRows`.
  - `updates.length === 0`이면 에러 메시지(오류 배열은 그대로 반환).
  - `updatePaymentRequestsBulk(ctx, updates)` 호출 → 찾지 못한 `seqNo`는 원래 행 번호로 역매핑해 오류 배열에 합침.
  - `revalidatePath("/expenses")`, `{updated, rowErrors}` 형태로 반환.

### `src/app/(app)/expenses/payment-request/upload-state.ts` (신규)

- `PaymentRequestUploadState = ActionState & { updated?: number; rowErrors?: {row:number; message:string}[] }` (payees의 `upload-state.ts`와 동일 패턴).

### `src/app/(app)/expenses/PaymentRequestExcelUploadModal.tsx`

- `useActionState(uploadPaymentRequestUpdatesAction, INIT)` + `<form action={formAction}>`로 실제 제출 연결(현재 `alert` 스텁 제거).
- `FileDropzone accept=".xlsx,.xls,.csv"` → `accept=".xlsx"`, 힌트 텍스트도 ".xlsx"만 언급하도록 수정.
- 성공/오류 메시지 및 `rowErrors` 목록 표시는 `PayeeUploadModal.tsx`의 렌더링 패턴 재사용(성공 시 `router.refresh()` + 오류 없으면 모달 닫기).

### `src/app/(app)/expenses/PaymentRequestListPanel.tsx`

- "No" 컬럼 값을 `(page - 1) * PAYMENT_REQUEST_PAGE_SIZE + i + 1` → `r.seqNo`로 교체(`PaymentRequestRow`에 이미 추가된 필드 사용).

## 범위 밖 (변경하지 않음)

- `PaymentRequestBulkUpdateModal`(체크박스 선택 건 일괄 지급일/여부 수정 팝업)은 이번 범위 밖 — 별도 스텁으로 계속 남는다.
- `PaymentRequestDetailModal`의 저장 기능도 이번 범위 밖.
- CSV/XLS 업로드 지원 안 함(위 결정 사항 참고).
- `Payee.keyId`처럼 유형별 접두사(a001/b001) 형식은 적용하지 않는다 — `PaymentRequest`는 유형 구분이 없으므로 순수 정수 시퀀스.
- 기존 지급요청 엑셀 다운로드의 나머지 17개 컬럼(사업자명~청구방식) 서식/로직은 변경하지 않는다.

## 테스트 계획

- 마이그레이션: `npx prisma migrate status`로 적용 확인, 기존 시드/테스트 데이터에 대해 `seqNo`가 1부터 `requestedAt` 순으로 채번됐는지 수동 확인.
- 단위 테스트(`buildPaymentRequestUpdatesFromRows`): 정상 행 파싱, `No` 파싱 실패, `지급여부` 잘못된 값, `지급완료`인데 `지급일` 공란, `지급준비`+`지급일` 공란은 정상 처리, 헤더 누락.
- 단위 테스트(`updatePaymentRequestsBulk`): 존재하는 `seqNo`만 반영, 존재하지 않는 `seqNo`는 `notFound`로 보고, 소프트 삭제된 건은 매칭 제외, `payDate` 공란 업로드 시 기존 값이 null로 지워지는지.
- 단위 테스트(엑셀 빌더): "No"/"지급일"/"지급여부" 헤더와 값, 지급여부 드롭다운 유효성 검사가 걸려있는지.
- 수동 검증: 다운로드 → 일부 행만 지급일/지급여부 수정 → 재업로드 → 해당 건만 반영되고 나머지는 그대로인지, 오류 행(잘못된 No, 형식 오류) 안내 확인, 목록 화면 "No"가 이제 고정값으로 보이는지.
