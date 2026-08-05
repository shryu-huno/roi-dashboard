# PM 엑셀 대량 등록 — 매칭 조건 완화 + 예외 건 은행정보 스냅샷 — 설계

작성일: 2026-08-05

## 배경

PM 엑셀 대량 등록(`buildPaymentRequestRegistrationRowsFromXlsx` →
`createPaymentRequestsFromUpload`)은 현재 진행 중(미커밋)인 리워크로,
사업자명+계좌번호가 지급 리스트(Payee)와 모두 일치하면 자동 연동되고,
아니면 "예외 건"(신규 등록)으로 엑셀 값을 그대로 저장한다.

실사용 중 두 가지 문제가 발견됐다:

1. `paymentRequestUploadRowSchema`의 `taxType`(청구방식)이 매칭 여부와
   무관하게 항상 필수(`z.enum`)라, 지급 리스트와 자동 연동되는 건도 청구방식을
   입력해야 한다.
2. 등록 양식에는 "은행명"/"예금주" 컬럼이 있지만
   `buildPaymentRequestRegistrationRowsFromXlsx`가 이 두 컬럼을 아예 읽지
   않고 버린다. 정산담당자 다운로드(`listPaymentRequestsForExport`)는 은행명
   /계좌번호/예금주를 오직 연동된 Payee 조인에서만 가져오므로(주석: "payeeId가
   없는 건은 빈 문자열로 채운다"), 예외 건(매칭 실패)은 엑셀에 값을 채워
   업로드해도 다운로드에서 항상 빈칸으로 나온다.

## 요구사항

### 청구방식/은행명/예금주 — 동일한 조건부 필수 규칙

세 필드 모두 다음 규칙을 따른다(매칭 성공 여부는 DB 조회 후에만 알 수 있으므로,
아래 판단은 전부 `createPaymentRequestsFromUpload`에서 수행한다 — 스키마
단계에서는 세 필드 모두 빈 문자열을 허용하는 선택 입력이다):

- **매칭됨** (사업자명+계좌번호가 지급 리스트와 일치): 엑셀 값이 비어있으면
  Payee의 실제 값을 그대로 사용한다(자동 연동). 엑셀 값이 채워져 있는데
  Payee의 실제 값과 다르면 해당 행을 오류로 처리해 업로드를 거부한다(다른
  행은 정상 반영되고, 이 행만 오류 목록에 나타나 사용자가 수정 후
  재업로드한다 — 기존 "찾은 것만 갱신" 방식과 달리 이 함수는 이미 오류가
  하나라도 있으면 전체 저장을 하지 않는 all-or-nothing 방식을 유지한다).
- **매칭 안 됨(예외 건)**: 엑셀 값이 비어있으면 오류(해당 항목이 지급
  리스트에 없어 필수임을 안내). 채워져 있으면 그 값을 그대로 사용해 새
  `PaymentRequest`에 저장한다.

계좌번호(`accountNumber`)는 매칭 키이므로 이 규칙과 무관하게 계속 항상
필수다.

### 은행명/계좌번호/예금주 스냅샷 저장

`PaymentRequest`에 `bizName`/`taxType`와 동일한 성격의 스냅샷 컬럼
`bankName`/`accountNumberEnc`/`accountHolder`를 추가한다. 매칭 여부와
무관하게 모든 건에 채워진다(매칭 건은 Payee의 값 그대로, 예외 건은 엑셀
입력값). 정산담당자 다운로드는 이 세 컬럼을 `PaymentRequest`에서 직접
읽는다 — 더는 Payee 조인에 의존하지 않는다(고유번호/연락처/사업자번호는
계속 Payee 조인 유지, 이번 변경 범위 아님 — 이 세 값은 예외 건에 대응하는
개념 자체가 없다).

## 설계

### 1. Prisma 스키마 (`prisma/schema.prisma`)

`PaymentRequest`에 필드 3개 추가:

```prisma
model PaymentRequest {
  ...
  bizName          String
  bankName         String     // 신규
  accountNumberEnc String     // 신규 — Payee.accountNumberEnc와 동일한 AES-GCM 암호화
  accountHolder    String     // 신규
  taxType          TaxType
  ...
}
```

기존 행이 전부 매칭 건(= `payeeId`가 있는 건)이므로, 마이그레이션은
Payee의 `accountNumberBidx` 작업과 동일한 3단계 패턴을 따른다:

1. `bankName`/`accountNumberEnc`/`accountHolder`를 nullable로 추가.
2. 기존 행을 연동된 Payee의 값으로 백필하는 SQL(`UPDATE "PaymentRequest" pr
   SET "bankName" = p."bankName", "accountNumberEnc" = p."accountNumberEnc",
   "accountHolder" = p."accountHolder" FROM "Payee" p WHERE pr."payeeId" =
   p."id"`).
3. 세 컬럼을 `NOT NULL`로 확정.

세 단계 모두 하나의 마이그레이션(`20260805040000_add_payment_request_snapshot_fields`)
안에 순서대로 넣는다(백필 SQL이 포함되므로 별도 백필 스크립트 불필요 —
Payee의 accountNumberBidx 때와 달리 RLS로 막힐 위험이 없다: 마이그레이션은
DB 마이그레이션 세션에서 실행되며 RLS 세션 변수와 무관하게 슈퍼유저/테이블
소유자 권한으로 적용됨).

### 2. 업로드 스키마 (`src/lib/validation/schemas.ts`)

`paymentRequestUploadRowSchema` 수정 — `bankName`/`accountHolder` 필드
추가, `taxType`를 선택 입력으로 변경:

```ts
export const paymentRequestUploadRowSchema = z.object({
  entity: z.enum(PAYMENT_REQUEST_ENTITY_LABELS),
  clientName: z.string().trim().min(1, "고객사명을 입력하세요."),
  bizName: z.string().trim().min(1, "사업자명을 입력하세요."),
  accountNumber: accountField,
  bankName: z.string().trim(),
  accountHolder: z.string().trim(),
  unitPrice: z.coerce.number().int().min(1),
  transportFee: z.coerce.number().int().min(0),
  materialFee: z.coerce.number().int().min(0),
  count: z.coerce.number().int().min(1),
  taxType: z.union([z.literal(""), z.enum(TAX_TYPE_LABELS)]),
  memo: z.string(),
});
```

### 3. 파싱 (`src/lib/data/payment-request-registration-upload.ts`)

- `REGISTRATION_TEMPLATE_HEADERS`는 이미 "은행명"/"예금주"를 포함하고
  있으므로 그대로 둔다(헤더 자체는 안 바뀜, 읽지 않던 걸 읽게 됨).
- `ParsedRegistrationRow`에 `bankNameRaw: string`, `accountHolderRaw: string`
  추가.
- `buildPaymentRequestRegistrationRowsFromXlsx`의 `paymentRequestUploadRowSchema.safeParse(...)`
  호출에 `bankName: at(cells, "은행명")`, `accountHolder: at(cells, "예금주")`를
  추가하고, 결과 push 시 `bankNameRaw: d.bankName`, `accountHolderRaw:
  d.accountHolder`를 담는다.

### 4. 매칭/저장 (`src/lib/data/payment-requests.ts`)

`createPaymentRequestsFromUpload`의 매칭 루프(현재 540-561행 부근)를
수정한다. 매칭 후 `resolved` 배열에 담기 전에 세 필드를 판정하는 헬퍼를
루프 안에서 인라인으로 처리(다른 대량 처리 함수와 마찬가지로 별도 함수로
빼지 않고 이 함수 내부에 둔다 — 이 로직은 이 업로드 경로 전용):

```ts
function resolveMatchedField(
  raw: string,
  payeeValue: string | null,
  fieldLabel: string,
): { value: string } | { error: string } {
  if (payeeValue !== null) {
    if (raw === "" || raw === payeeValue) return { value: payeeValue };
    return { error: `${fieldLabel}이(가) 지급 리스트와 일치하지 않습니다.` };
  }
  if (raw === "") return { error: `${fieldLabel}을(를) 입력하세요(지급 리스트에 없는 경우 필수).` };
  return { value: raw };
}
```

(`taxType`은 라벨↔enum 변환이 필요하므로, 매칭된 경우 `payee.taxType`을
`taxTypeLabel(payee.taxType)`로 라벨 문자열로 되돌려 `resolveMatchedField`의
`payeeValue`로 넘겨 `data.taxTypeRaw`와 라벨 대 라벨로 비교한다.
`resolveMatchedField`가 반환한 `{ value }`(라벨 문자열)를 호출부가
`TAX_TYPE_BY_LABEL[value]`로 enum으로 변환해 `resolved`에 담는다.
`taxTypeLabel`을 `@/lib/labels`에서 새로 import한다(현재 파일은
`TAX_TYPE_BY_LABEL`만 import 중).)

행별로 `taxType`/`bankName`/`accountHolder`에 각각 `resolveMatchedField`를
호출해 하나라도 `error`면 그 행을 `errors`에 push하고 다음 행으로
넘어간다(기존 "동일한 이름의 고객사가 여러 건" 등과 동일한 스타일).
전부 성공하면 `resolved`에 `bankName`, `accountNumberEnc`(매칭 건은
`payee.accountNumberEnc` 그대로, 예외 건은 `encrypt(data.accountNumberDigits)`),
`accountHolder`, `taxType`(TaxType enum)을 채운다.

배치 조회(`payeesByAccountBidx`)에서 가져오는 Payee 필드에 `bankName`,
`accountNumberEnc`, `accountHolder`를 추가로 select해야 한다(현재는 `id`,
`bizName`, `taxType`만 조회).

`resolved`의 타입과 `tx.paymentRequest.create({ data: {...} })` 호출에
`bankName`, `accountNumberEnc`, `accountHolder` 3개 필드를 추가한다.

`encrypt`를 `@/lib/crypto/payee-secret`에서 새로 import한다(현재 파일은
`decrypt`/`blindIndex`만 import 중).

### 5. 정산담당자 다운로드 (`listPaymentRequestsForExport`)

`tx.paymentRequest.findMany`의 `include.payee.select`에서 `bankName`/
`accountNumberEnc`/`accountHolder`를 제거한다(더는 조인에서 가져오지
않음 — `keyId`/`phone`/`bizNumberEnc`는 유지). 반환 매핑에서:

```ts
bankName: r.bankName,
accountNumber: decrypt(r.accountNumberEnc),
accountHolder: r.accountHolder,
```

로 변경(PaymentRequest 자체 필드에서 직접 읽음, `r.payee?.` 접두사 제거).
함수 상단 주석("나머지 지급 리스트 정보... payeeId가 없는 건은 빈
문자열로 채운다")도 이 변경에 맞게 갱신한다.

### 6. 등록 양식 UI (`src/app/(app)/expenses/payment-request/xlsx.ts`)

`REGISTRATION_HEADER_NOTES`:

```ts
"청구방식": "선택 — 지급 리스트와 자동 연동되면 생략 가능(단, 값을 입력했는데 지급 리스트와 다르면 오류). 지급 리스트에 없으면 필수.",
"은행명": "선택 — 지급 리스트와 자동 연동되면 생략 가능(단, 값을 입력했는데 지급 리스트와 다르면 오류). 지급 리스트에 없으면 필수.",
"예금주": "선택 — 지급 리스트와 자동 연동되면 생략 가능(단, 값을 입력했는데 지급 리스트와 다르면 오류). 지급 리스트에 없으면 필수.",
```

청구방식 드롭다운 데이터 유효성 검사(`dataValidations.add(taxTypeCol...)`)의
`allowBlank: false` → `true`로 변경.

## 테스트

- `test/schemas.test.ts`: `paymentRequestUploadRowSchema` — 청구방식/은행명/
  예금주가 빈 문자열이어도 통과, 청구방식에 유효하지 않은 문자열을 넣으면
  거부.
- `test/payment-request-registration-upload.test.ts`: 은행명/예금주 셀이
  `ParsedRegistrationRow.bankNameRaw`/`accountHolderRaw`로 채워지는지.
- `test/data-payment-requests.test.ts` (`createPaymentRequestsFromUpload`):
  - 매칭 + 세 필드 모두 공란 → Payee 값 그대로 저장.
  - 매칭 + 세 필드 중 하나가 Payee 값과 다름 → 해당 행만 오류, 전체
    업로드 거부(다른 정상 행이 있어도 하나도 저장되지 않음 — 기존
    all-or-nothing 유지 확인).
  - 예외 건 + 세 필드 중 하나라도 공란 → 오류.
  - 예외 건 + 세 필드 모두 입력 → 그대로 저장되고 `accountNumberEnc`가
    올바르게 암호화됐는지(복호화해서 원본 계좌번호와 일치 확인).
  - `listPaymentRequestsForExport`: 예외 건도 은행명/계좌번호/예금주가
    채워져서 나오는지(기존 "빈 문자열"이 아님을 확인).
- `test/payment-request-xlsx.test.ts`: 청구방식 드롭다운 `allowBlank`가
  `true`인지, 헤더 노트 문구 갱신 확인.

## 범위 제외

- 고유번호(`keyId`)/연락처(`phone`)/사업자번호(`bizNumber`)는 계속 Payee
  조인 전용이며 예외 건은 계속 빈 문자열이다(이 세 값은 애초에 엑셀
  등록 양식에 입력 컬럼이 없다 — 범위 밖).
- 예외 건을 지급 리스트(Payee)에 자동으로 신규 등록하는 기능은 만들지
  않는다(브레인스토밍에서 검토했으나, 정산담당자 다운로드에 값을
  채우는 것만으로 요구사항이 충족되고, 지급 리스트를 자동으로 늘리는
  것은 별도 운영 판단이 필요해 제외).
- 매칭 로직 자체(사업자명+계좌번호 기준, 블라인드 인덱스 조회)는 이번
  변경과 무관하며 그대로 둔다.
- 지급요청 등록 화면(PM이 직접 입력하는 폼, `PaymentRequestNewForm`)이나
  일반 목록/상세 화면은 건드리지 않는다 — 이번 변경은 엑셀 대량 등록
  경로(`createPaymentRequestsFromUpload`)와 정산담당자 다운로드
  (`listPaymentRequestsForExport`)에만 적용된다.
