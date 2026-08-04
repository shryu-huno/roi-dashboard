# PM 지급요청 엑셀 대량 등록 설계

## 배경

PM 등록 화면(`/expenses/payment-request/new`, `PaymentRequestNewForm.tsx`)에는 행 편집기로 한 건씩 입력하는 방식만 있고, "엑셀 업로드" 버튼은 `alert("추후 구현 예정입니다.")` 스텁이다. 지급요청 건수가 많은 PM이 엑셀로 한 번에 등록할 수 있도록 이 기능을 구현한다.

업로드 컬럼 구성은 정산담당자가 받는 지급요청 다운로드 컬럼(`payment-request/xlsx.ts`의 `EXPORT_HEADERS`, 20개)을 기준으로 하되, PM이 입력할 필요가 없거나 서버가 채우는 항목은 제외한다.

## 현재 상태 (조사 결과)

- `PaymentRequest`(`prisma/schema.prisma`)에는 연락처/은행명/계좌번호/예금주/사업자번호를 담을 컬럼이 없다. 이 정보는 전부 `Payee`(지급 리스트 마스터)에만 있고, `PaymentRequest.payeeId`(nullable FK)로 연동해 다운로드 시점에만 조회한다(`listPaymentRequestsForExport`).
- 등록 시 `bizName`/`taxType`은 클라이언트가 보낸 값을 신뢰하지 않고, 서버가 `payeeId`로 `Payee`를 재조회한 값을 스냅샷으로 저장한다(`createPaymentRequestsBulk`, `updatePaymentRequest`, `updatePaymentRequestPmFields` 전부 동일 원칙).
- 현재 수동 등록 검증(`paymentRequestRowSchema`, `validateDraftRows`)은 `payeeId`를 항상 필수로 요구한다 — 지급 리스트에 없는 예외 건을 등록할 방법이 화면에 없다(스키마는 nullable을 허용하지만 실제 경로가 없음).
- 정산담당자 엑셀 다운로드(`/expenses/payment-request/export`)는 `requireRole("SETTLEMENT")` 전용이라 PM은 접근할 수 없다 — PM용 업로드 양식은 별도로 만들어야 한다.
- 엑셀 파싱/생성은 `exceljs` 기반 기존 유틸(`parseXlsxToRows`, `payees/xlsx.ts`의 `buildTemplateXlsxBuffer` 패턴, `payees/build-inputs.ts`의 헤더-별칭 매핑 + zod 검증 패턴)을 재사용한다.
- `Payee`에는 정확일치 검색용 `bizNumberBidx`(HMAC 블라인드 인덱스, `blindIndex()`)와 `keyId`(unique, a001/b001)가 있어 두 값 모두 매칭키로 쓸 수 있다.
- 지급 리스트 등록 업로드(`PayeeUploadModal.tsx`)가 이미 "팝업 안에 파일 드롭존 + 서식 다운로드 링크 + 업로드 실행 버튼 + 행별 오류 목록" 패턴을 갖추고 있다 — 이번 기능의 UI가 이 패턴을 그대로 따른다.

## 결정 사항

### 1. 업로드 양식 컬럼 (15개, 순서대로)

`지급명의, 고객사명, 사업자명(이름), 고유번호, 연락처, 사업자번호(주민등록번호), 은행명, 계좌번호, 예금주, 단가, 교통비, 재료비, 횟수, 청구방식, 상세내역`

정산담당자 다운로드 20컬럼에서 제외한 5개: `No`(자동 채번), `신청인`(로그인한 PM으로 자동 저장), `지급일`/`지급여부`(등록 시 관여하지 않음, 정산담당자 전담), `총지급액`(서버가 단가+교통비+재료비×횟수로 재계산, 업로드 값 신뢰 안 함).

### 2. 사업자(지급 리스트) 매칭 — 고유번호/사업자번호를 매칭키로

- **매칭 우선순위**: 고유번호가 있으면 그것으로, 없고 사업자번호가 있으면 그것(블라인드 인덱스)으로 활성 `Payee`(`deletedAt: null`)를 조회한다. 어느 쪽이든 값이 있는데 매칭되는 대상을 못 찾으면 그 행은 오류 처리한다(둘 다 없을 때만 예외 건으로 넘어간다 — 값이 있는데 조용히 무시하지 않는다).
- **매칭된 행("연동 행")**: `payeeId` 연동. `사업자명`/`청구방식`은 무조건 `Payee` 마스터 값으로 확정하고, 엑셀에 입력된 값은 무시한다(기존 등록/수정 로직과 동일 원칙).
- **매칭 안 된 행("예외 행", 고유번호·사업자번호 둘 다 공란)**: `payeeId` 없이 저장. `사업자명`/`청구방식`은 엑셀 값을 그대로 사용 — 이 두 컬럼은 예외 행에서만 필수다.
- **연락처/은행명/계좌번호/예금주는 어느 경우든 DB에 저장하지 않는다** — `PaymentRequest`에 저장할 컬럼이 없기 때문이다(스키마 변경도, 신규 `Payee` 자동생성도 하지 않기로 결정).
- **고객사명 매칭**: 등록된 활성 고객사명과 정확히 일치(공백 트리밍)해야 한다. 못 찾으면 오류. `Client.name`은 DB상 unique 제약이 없으므로, 동일 이름이 여러 건이면 "자동 선택 불가" 오류로 처리한다(신규 고객사 자동 생성 없음 — 수동 등록 화면과 동일 원칙).

### 3. 컬럼별 필수 여부

| 컬럼 | 연동 행(고유번호/사업자번호 있음) | 예외 행(둘 다 없음) |
|---|---|---|
| 지급명의 | 필수 | 필수 |
| 고객사명 | 필수 | 필수 |
| 사업자명(이름) | 선택(참고용, 무시됨) | **필수**(저장됨) |
| 고유번호 | 매칭키(사업자번호와 양자택일) | - |
| 연락처 | 선택(참고용, 저장 안 됨) | 선택(참고용, 저장 안 됨) |
| 사업자번호(주민등록번호) | 매칭키(고유번호와 양자택일) | - |
| 은행명 | 선택(참고용, 저장 안 됨) | 선택(참고용, 저장 안 됨) |
| 계좌번호 | 선택(참고용, 저장 안 됨) | 선택(참고용, 저장 안 됨) |
| 예금주 | 선택(참고용, 저장 안 됨) | 선택(참고용, 저장 안 됨) |
| 단가 | 필수(1 이상) | 필수(1 이상) |
| 교통비 | 선택(공란=0) | 선택(공란=0) |
| 재료비 | 선택(공란=0) | 선택(공란=0) |
| 횟수 | 필수(1 이상) | 필수(1 이상) |
| 청구방식 | 선택(참고용, 무시됨) | **필수**(저장됨) |
| 상세내역 | 선택(공란 허용) | 선택(공란 허용) |

고유번호/사업자번호가 입력됐지만 형식이 잘못된 경우(사업자번호가 10/13자리 숫자가 아님 등)는 매칭 시도 전에 형식 오류로 처리한다.

### 4. 오류 처리 — all-or-nothing

한 행이라도 오류(형식 오류, 고객사/사업자 매칭 실패 등)가 있으면 **전체를 저장하지 않고** 오류 행 목록("N행: 사유")만 안내한다. 수동 등록 화면(`handleSave`)과 동일한 방식이며, 기존 다른 엑셀 업로드 기능들(지급 리스트 등록/지급일 재업로드)의 부분성공 방식과는 다르다 — PM 등록 경로는 항상 all-or-nothing으로 통일한다.

검증은 2단계로 진행한다: 먼저 형식(헤더, 필수값, 숫자 범위, 사업자번호 자릿수 등)을 DB 접근 없이 검사하고, 형식 오류가 있으면 그 목록만 반환한다(매칭 시도 안 함). 형식이 모두 통과하면 그다음 고객사/사업자 매칭을 시도해 오류를 모은다.

### 5. 업로드 UI — 팝업(모달) 안에 서식 다운로드 + 업로드

`PayeeUploadModal.tsx`와 동일한 구조:
- `PaymentRequestNewForm.tsx`의 "엑셀 업로드" 버튼(현재 `alert` 스텁)을 누르면 모달이 뜬다.
- 모달 안: 파일 드롭존(`.xlsx`만), 업로드 항목 안내, 하단에 "⬇ 엑셀 서식 다운로드" 링크와 "⬆ 업로드 실행" 버튼.
- 서식 다운로드는 헤더 15개 + 지급명의/청구방식 드롭다운(데이터 유효성 검사)이 적용된 빈 템플릿.
- 업로드 성공 시 등록 건수 안내 + 목록 갱신 + 모달 닫힘(모달을 등록 화면에서 직접 열므로 별도 페이지 이동 없음 — 성공 후 PM이 방금 등록한 건을 목록에서 확인하려면 "취소"로 목록 화면으로 이동해야 함, 기존 수동 저장과 동일하게 `/expenses?tab=payment-request`로 이동은 하지 않음. 대신 `router.refresh()`로 화면 내 상태만 갱신).
- 오류 시: 행별 오류 목록("N행: 사유")을 모달에 표시, 모달은 닫히지 않음(재시도 가능).

## 아키텍처 / 데이터 흐름

```
[PaymentRequestNewForm "엑셀 업로드" 버튼]
        |
[PaymentRequestExcelRegisterModal] --서식 다운로드--> GET /expenses/payment-request/registration-template
        |
        --업로드(file)--> uploadPaymentRequestCreatesAction (서버 액션, 신규)
                                |
                        requireRole("PM")
                                |
                parseXlsxToRows(file)  (payees/xlsx.ts 재사용)
                                |
        buildPaymentRequestRegistrationRowsFromXlsx(rows)  (신규, 순수 함수 — 형식 검증)
                                |
                    형식 오류 있음? --있음--> { ok:false, rowErrors }
                                |없음
        createPaymentRequestsFromUpload(ctx, requesterId, rows)  (신규, 데이터 계층 — 매칭+저장)
                                |
                고객사/사업자 매칭 오류 있음? --있음--> { ok:false, rowErrors } (미저장)
                                |없음
                        전체 insert (withRLS 트랜잭션)
                                |
                { ok:true, created } → 모달에 성공 안내 + router.refresh()
```

## 변경 파일

### `src/lib/validation/schemas.ts`

- 신규 `paymentRequestUploadRowSchema` — 엑셀 한 행(문자열 필드) 검증용. `superRefine`으로 "고유번호/사업자번호 둘 다 없으면 사업자명/청구방식 필수" 조건부 규칙을 표현한다.
  - `entity`: `z.enum(PAYMENT_REQUEST_ENTITY_LABELS)` → 이후 `PAYMENT_REQUEST_ENTITY_BY_LABEL`로 변환.
  - `clientName`: `z.string().min(1)`.
  - `bizNameRaw`: `z.string()` (빈 문자열 허용, superRefine에서 조건부 검사).
  - `keyId`: `z.string()` (빈 문자열 허용).
  - `bizNumberRaw`: `z.string()` — 비어있지 않으면 `digitsOnly` 후 10/13자리인지 검사(기존 `bizNumberDigits` 스키마 패턴 재사용, `allowBlank` 버전).
  - `unitPrice`: `z.coerce.number().int().min(1)`.
  - `transportFee`/`materialFee`: `z.coerce.number().int().min(0)`, 빈 문자열은 전처리로 0 취급.
  - `count`: `z.coerce.number().int().min(1)`.
  - `taxTypeRaw`: `z.string()` (빈 문자열 허용, superRefine에서 조건부 검사 — 값이 있으면 `TAX_TYPE_LABELS` 중 하나여야 함).
  - `memo`: `z.string()`.

### `src/lib/data/payment-request-registration-upload.ts` (신규)

- `REGISTRATION_TEMPLATE_HEADERS` 상수 — 결정 사항 1의 15개 헤더(문자열 배열, `as const`).
- `buildPaymentRequestRegistrationRowsFromXlsx(rows: string[][]): { rows: { row: number; data: ParsedRegistrationRow }[]; errors: { row: number; message: string }[] }`
  - `payees/build-inputs.ts`의 헤더-매핑 + 빈 행 skip 패턴 재사용.
  - 헤더 누락 시 즉시 오류 반환(매칭 시도 안 함).
  - 행마다 `paymentRequestUploadRowSchema`로 검증 → 실패 시 오류 배열에 추가.
  - `ParsedRegistrationRow` 타입: `{ entity, clientName, bizNameRaw, keyId: string | null, bizNumberDigits: string | null, taxTypeRaw: string | null, unitPrice, transportFee, materialFee, count, memo }` (keyId/bizNumberDigits는 빈 문자열이면 null로 정규화).

### `src/lib/data/payment-requests.ts`

- 신규 타입 `PaymentRequestUploadResolveError = { row: number; message: string }`.
- 신규 함수 `createPaymentRequestsFromUpload(ctx: RlsContext, requesterId: string, rows: { row: number; data: ParsedRegistrationRow }[]): Promise<{ ok: true; created: number } | { ok: false; errors: PaymentRequestUploadResolveError[] }>`
  - `withRLS` 트랜잭션 안에서 각 행을 순회하며 먼저 전부 조회(읽기)만 수행 — 고객사명으로 활성 `Client` 조회(0건/2건 이상이면 오류), 고유번호 또는 사업자번호(블라인드 인덱스)로 활성 `Payee` 조회(있는데 못 찾으면 오류).
  - 오류가 하나라도 있으면 아직 insert 전이므로 그대로 `{ ok: false, errors }` 반환(빈 트랜잭션 커밋, 별도 롤백 처리 불필요).
  - 오류가 없으면 각 행을 insert — 매칭된 행은 `payeeId`+`Payee.bizName`/`taxType`, 예외 행은 `payeeId: null`+엑셀의 `bizNameRaw`/`TAX_TYPE_BY_LABEL[taxTypeRaw]`. `amount`는 서버가 재계산.
  - 기존 `createPaymentRequestsBulk`(수동 등록 전용, `payeeId` 항상 필수)는 건드리지 않는다 — 입력 형태(이름/키 문자열 vs 이미 확정된 ID)가 근본적으로 달라 별도 함수로 분리.

### `src/app/(app)/expenses/payment-request/xlsx.ts`

- 신규 함수 `buildPaymentRequestRegistrationTemplateXlsxBuffer(): Promise<Buffer>` — `payees/xlsx.ts`의 `buildTemplateXlsxBuffer`를 본떠 작성.
  - 헤더 15개(`REGISTRATION_TEMPLATE_HEADERS`), 사업자번호·계좌번호 컬럼 텍스트 서식(`numFmt:"@"`).
  - 지급명의 컬럼: 드롭다운(`PAYMENT_REQUEST_ENTITY_LABELS`).
  - 청구방식 컬럼: 드롭다운(`TAX_TYPE_LABELS`, `allowBlank: true` — 연동 행은 비워도 되므로).
  - 헤더 메모(`cell.note`)로 "연동 행(고유번호/사업자번호 입력 시)은 선택사항" 안내를 사업자명/연락처/은행명/계좌번호/예금주/청구방식 헤더에 추가.
  - 헤더 행 고정, 굵게+배경색, 데이터 행 잠금 해제 후 시트 보호 — 기존 패턴 그대로.

### `src/app/(app)/expenses/payment-request/registration-template/route.ts` (신규)

- GET 핸들러. `requireRole("PM")`(ADMIN/SETTLEMENT도 랭크상 통과, `payees/template/route.ts`와 동일 패턴).
- `buildPaymentRequestRegistrationTemplateXlsxBuffer()` 호출 후 `지급요청_등록양식.xlsx`로 다운로드 응답.

### `src/app/(app)/expenses/payment-request/create-upload-state.ts` (신규)

- `PaymentRequestCreateUploadState = ActionState & { created?: number; rowErrors?: { row: number; message: string }[] }` (`upload-state.ts`와 동일 패턴, 이름만 구분).

### `src/app/(app)/expenses/payment-request/actions.ts`

- 신규 `"use server"` 함수 `uploadPaymentRequestCreatesAction(_prev: PaymentRequestCreateUploadState, formData: FormData)`:
  - `requireRole("PM")` → 다른 역할은 즉시 거부(SETTLEMENT/ADMIN은 이 화면 자체에 접근하지 않음).
  - 파일 확장자 `.xlsx` 확인.
  - `parseXlsxToRows`(기존 함수, `payees/xlsx.ts`에서 import) → `buildPaymentRequestRegistrationRowsFromXlsx`.
  - 형식 오류가 있으면 즉시 `{ ok: false, rowErrors }` 반환(매칭 시도 안 함).
  - `createPaymentRequestsFromUpload(ctx, user.id, rows)` 호출 → 실패 시 `{ ok: false, rowErrors: result.errors }`.
  - 성공 시 `revalidatePath("/expenses")`, `{ ok: true, created, message: "${created}건 등록" }` 반환.

### `src/app/(app)/expenses/PaymentRequestExcelRegisterModal.tsx` (신규)

- `PayeeUploadModal.tsx` 구조를 그대로 따르는 신규 컴포넌트(기존 `PaymentRequestExcelUploadModal.tsx`는 정산담당자의 지급일/지급여부 재업로드 전용이라 건드리지 않음 — 이름 충돌 방지를 위해 `...Register...`로 구분).
- `useActionState(uploadPaymentRequestCreatesAction, CREATE_UPLOAD_INIT)`.
- `FileDropzone accept=".xlsx"`.
- 하단 "⬇ 엑셀 서식 다운로드"(`href="/expenses/payment-request/registration-template"`) + "⬆ 업로드 실행" 버튼.
- 성공(`state.ok && state.created`) 시 `router.refresh()` + 모달 닫기. 오류/행오류(`state.rowErrors`) 있으면 목록 표시하고 모달 유지.

### `src/app/(app)/expenses/PaymentRequestNewForm.tsx`

- `handleExcelUpload`의 `alert` 스텁 제거, `isUploadModalOpen` state 추가 후 버튼 클릭 시 `PaymentRequestExcelRegisterModal` 오픈.
- 모달이 성공적으로 등록을 반영하면(내부에서 `router.refresh()`) 화면의 등록 화면 자체는 그대로 유지(추가로 수동 입력 중이던 행 편집기 내용은 건드리지 않는다).

## 범위 밖 (변경하지 않음)

- `PaymentRequest`/`Payee` Prisma 스키마 변경 없음(신규 컬럼/마이그레이션 없음) — 연락처/은행명/계좌번호/예금주 스냅샷 저장은 이번 범위 밖.
- 예외 행에 대해 신규 `Payee` 마스터 레코드를 자동 생성하는 기능은 만들지 않는다.
- 기존 수동 등록 경로(`createPaymentRequestsBulk`, `PaymentRequestRowsTable`)는 변경하지 않는다 — 여전히 `payeeId` 필수, 콤보박스 선택 전용.
- 기존 정산담당자용 엑셀 다운로드/재업로드(지급일·지급여부) 기능은 변경하지 않는다.
- CSV/XLS 업로드 지원 안 함(`.xlsx`만).
- 업로드된 연락처/은행명/계좌번호/예금주 값과 매칭된 `Payee`의 실제 값이 다를 때 경고/불일치 안내는 하지 않는다(애초에 참고용으로만 취급, 검증 자체를 안 함).

## 테스트 계획

- 단위 테스트(`buildPaymentRequestRegistrationRowsFromXlsx`): 헤더 누락, 빈 행 skip, 지급명의/사업자번호 형식 오류, 연동 행(고유번호만/사업자번호만/둘 다) 형식 통과 시 사업자명·청구방식 미검증, 예외 행(둘 다 공란)일 때 사업자명·청구방식 필수 검증, 단가/횟수 0 이하 오류, 교통비/재료비 공란 시 0 처리.
- 단위 테스트(`createPaymentRequestsFromUpload`): 고유번호 매칭 성공(연동 행 저장 값이 Payee 스냅샷과 일치), 사업자번호 매칭 성공, 매칭 실패(존재하지 않는 고유번호/사업자번호) 시 미저장 + 오류 반환, 예외 행 저장(payeeId null, 엑셀 값 그대로), 고객사명 못 찾음/중복 시 오류, 오류 있으면 정상 행도 전부 미저장(all-or-nothing) 확인, `amount` 서버 재계산 확인.
- 단위 테스트(템플릿 생성): 헤더 15개 순서, 지급명의/청구방식 드롭다운 유효성 검사 존재.
- 수동 검증(`npm run dev`, PM 계정): 엑셀 업로드 버튼 → 모달 → 서식 다운로드 → 값 채워 업로드(연동 행/예외 행 섞어서) → 정상 등록 확인, 오류 섞은 파일 업로드 시 전체 미저장 + 행별 오류 안내 확인, 목록 화면에서 등록된 건의 사업자명/청구방식이 지급 리스트 마스터 값과 일치하는지(연동 행) 확인.
