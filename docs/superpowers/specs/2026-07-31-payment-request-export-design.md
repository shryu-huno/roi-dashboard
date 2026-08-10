# 지급요청 목록 엑셀 다운로드 기능 설계

## 배경

`/expenses` 페이지의 "지급요청" 탭(`PaymentRequestListPanel.tsx`)에는 "📗 엑셀 다운로드" 버튼이 이미 배치돼 있으나 `onClick={() => alert(NOT_IMPLEMENTED)}` 스텁 상태다. 이 문서는 정산담당자/관리자가 등록된 지급요청 건들을 엑셀로 다운로드하는 기능의 설계를 정리한다. 다운로드 파일에는 지급요청(PM 등록) 정보와 연동된 지급 리스트(Payee) 정보가 함께 포함되어야 한다.

## 현재 상태 (조사 결과)

- 탭 접근/다운로드 버튼 노출 권한: `canExport = role === "ADMIN" || role === "SETTLEMENT"` (`PaymentRequestListPanel.tsx:51`). PM은 버튼 자체가 보이지 않는다.
- 검색/필터: `payDateFrom/payDateTo/clientId/entity/status/bizName` 쿼리를 GET 폼으로 서버에 재조회. 목록은 50건 단위로 페이지네이션됨(`PAYMENT_REQUEST_PAGE_SIZE`).
- 체크박스 선택(`selected` state, `PaymentRequest.id` 기준)이 이미 있고 "일괄수정" 버튼이 이를 사용 중 — 다운로드 버튼도 동일한 선택 상태를 재사용할 수 있다.
- `PaymentRequest` 모델은 `bizName`/`taxType`을 등록 시점에 연동된 `Payee`에서 조회한 값을 **스냅샷**으로 저장한다(`createPaymentRequestsBulk`, 이후 `Payee` 정보가 바뀌어도 과거 신청 건은 영향받지 않음). `payeeId`는 nullable FK — 스키마상 지급 리스트와 연동되지 않은 예외 건도 허용하지만, 현재 등록 화면(`toPaymentRequestCreateInputs`)은 항상 `payeeId`를 요구하므로 실제로는 항상 채워진다.
- 지급 리스트 전용 정보(고유번호/연락처/사업자번호 원문/은행명/계좌번호 원문/예금주)는 `PaymentRequest`에 없고 연동된 `Payee`를 다시 조회해야 한다. 원문 복호화는 `decrypt()`(`@/lib/crypto/payee-secret`)로 기존 `listPayeesForExport`와 동일하게 처리한다.
- 엑셀 생성은 기존 `src/app/(app)/expenses/payees/xlsx.ts`의 `buildExportXlsxBuffer`(지급 리스트 다운로드용)를 스타일 기준으로 삼는다: 헤더 굵게+연파랑 배경(`FFD9E1F2`), 테두리, 가운데정렬, 헤더행 고정, 텍스트 서식(`numFmt: "@"`) 적용 컬럼, 열너비 자동계산(`displayWidth`).
- 지급 리스트 다운로드(`payees/export/route.ts`)는 체크박스 선택(`keyIds`)이 있으면 그 항목만(검색/필터 무시), 없으면 현재 검색/필터 결과 **전체**(페이지네이션 없이 DB에서 전부 조회)를 내려받는 방식이며, 이번 기능도 동일한 방식을 따른다.

## 결정 사항

- **다운로드 범위**: 체크박스로 선택한 행이 있으면 그 행들만(검색/필터 무시), 없으면 현재 검색/필터 조건에 맞는 전체 결과(페이지네이션 무시). 지급 리스트 다운로드와 동일.
- **사업자명(이름)·청구방식 소스**: `PaymentRequest`에 저장된 등록 시점 스냅샷 값을 그대로 사용한다. 지급 리스트(Payee)를 다시 조회하지 않는다 — 신청 당시 값을 보존하기 위함.
- **나머지 지급 리스트 연동 컬럼(고유번호/연락처/사업자번호/은행명/계좌번호/예금주)**: 연동된 `Payee`를 조회해 포함한다. 사업자번호·계좌번호는 마스킹이 아닌 복호화 원문 포함(지급 리스트 다운로드와 동일한 이유 — 다운로드 가능 역할이 이미 `ADMIN`/`SETTLEMENT`로 제한).
- **`payeeId`가 없는 예외 건**: 위 6개 컬럼을 빈 문자열로 표시한다. 별도 에러 처리는 하지 않는다(스키마상 가능하나 현재 등록 경로로는 발생하지 않음).
- **컬럼 순서(18열)**: `번호, 신청인, 지급명의, 고객사명, 사업자명(이름), 고유번호, 연락처, 사업자번호(주민등록번호), 은행명, 계좌번호, 예금주, 단가, 교통비, 재료비, 횟수, 총지급액, 청구방식, 상세내역`
  - `번호`는 DB 값이 아니라 다운로드 행의 순번(1부터).
  - `상세내역`은 `PaymentRequest.memo` 그대로(진행일자 등은 PM이 자유 기재하는 비고 내용이며 별도 컬럼을 만들지 않는다).
- **금액 컬럼 서식**: 단가/교통비/재료비/횟수/총지급액은 숫자 값 그대로 두되 천단위 콤마 서식(`numFmt: "#,##0"`) 적용.
- **파일명**: `지급요청리스트_YYYYMMDD.xlsx` (한국 시간 기준 날짜).
- **엑셀 스타일링**: 지급 리스트 다운로드와 동일 수준(열너비 자동조정, 헤더 굵게+배경색, 테두리, 헤더행 고정, 사업자번호/계좌번호 텍스트 서식). 읽기 전용 결과물이므로 드롭다운·유효성검사·메모·시트보호는 적용하지 않는다.
- **결과 0건 처리**: 다운로드 버튼을 비활성화(`title` 툴팁 안내), 지급 리스트 다운로드와 동일.
- **권한**: `requireRole("SETTLEMENT")` — ADMIN도 랭크상 자동 통과, 기존 `canExport` 조건과 동일.

## 아키텍처 / 데이터 흐름

```
[PaymentRequestListPanel 다운로드 링크]
  --GET /expenses/payment-request/export?ids=...  (선택 있음)
  --GET /expenses/payment-request/export?payDateFrom=&payDateTo=&clientId=&entity=&status=&bizName=  (선택 없음)
                                    |
                        requireRole("SETTLEMENT")
                                    |
              listPaymentRequestsForExport(ctx, filter?, ids?)   (신규)
                                    |
          buildPaymentRequestExportXlsxBuffer(rows)   (신규, payment-request/xlsx.ts)
                                    |
                        xlsx 파일 응답 (다운로드)
```

## 변경 파일

### `src/lib/data/payment-requests.ts`

- 신규 타입:

```ts
export type PaymentRequestExportRow = {
  requesterName: string;
  entity: PaymentRequestEntity;
  clientName: string;
  bizName: string;
  payeeKeyId: string;
  phone: string;
  bizNumber: string; // 복호화 원문
  bankName: string;
  accountNumber: string; // 복호화 원문
  accountHolder: string;
  unitPrice: number;
  transportFee: number;
  materialFee: number;
  count: number;
  amount: number;
  taxType: TaxType;
  memo: string;
};
```

- 신규 함수 `listPaymentRequestsForExport(ctx, filter?, ids?)`:
  - `ids`(선택된 `PaymentRequest.id[]`)가 있으면 `where: { id: { in: ids }, deletedAt: null }`로만 조회(다른 필터 무시).
  - 없으면 기존 `buildWhere(filter)` 재사용, `skip/take` 없이 전체 조회.
  - `include: { requester: { select: { name, email } }, client: { select: { name } }, payee: { select: { keyId, phone, bizNumberEnc, bankName, accountNumberEnc, accountHolder } } }`.
  - `payee`가 없는 행은 `payeeKeyId/phone/bizNumber/bankName/accountNumber/accountHolder`를 빈 문자열로 매핑.
  - `bizNumber`/`accountNumber`는 `decrypt()`(`@/lib/crypto/payee-secret`)로 복호화.
  - `bizName`/`taxType`은 `PaymentRequest` 필드 그대로 사용(Payee 재조회 없음).
  - 함수 자체에는 role 체크를 두지 않는다(`listPayeesForExport`와 달리, 이 함수는 RLS로 감싸는 `withRLS`를 그대로 통과시킬 뿐 role 예외를 던지지 않는다) — 호출부인 export 라우트가 `requireRole("SETTLEMENT")`로 접근을 제한한다.

### `src/app/(app)/expenses/payment-request/xlsx.ts` (신규)

- `buildPaymentRequestExportXlsxBuffer(rows: PaymentRequestExportRow[]): Promise<Buffer>`.
- `payees/xlsx.ts`의 `displayWidth` 로직과 동일한 열너비 계산을 복제(공유 유틸로 뽑지 않음 — 두 파일이 다루는 컬럼 성격이 달라 기존 패턴대로 각 xlsx 모듈이 자체 보유).
- 헤더 18열(위 컬럼 순서), 헤더 굵게+배경색(`FFD9E1F2`)+테두리+가운데정렬+헤더행 고정.
- 사업자번호·계좌번호 컬럼: `numFmt = "@"`.
- 단가·교통비·재료비·횟수·총지급액 컬럼: `numFmt = "#,##0"`.
- 지급명의는 `paymentRequestEntityLabel()`, 청구방식은 `taxTypeLabel()`로 한글 라벨 변환.
- 드롭다운/유효성검사/메모/시트보호는 적용하지 않는다.

### `src/app/(app)/expenses/payment-request/export/route.ts` (신규)

- GET 핸들러. `requireRole("SETTLEMENT")`.
- 쿼리 파라미터 `ids`(콤마 구분)가 있으면 `listPaymentRequestsForExport(ctx, undefined, ids)`, 없으면 기존 목록 화면과 동일한 파싱 함수(`parsePaymentRequestEntity`/`parsePaymentRequestStatus`/`parsePaymentRequestDateParam`)로 필터를 구성해 `listPaymentRequestsForExport(ctx, filter)` 호출.
- `buildPaymentRequestExportXlsxBuffer(rows)`로 버퍼 생성 후 `Content-Disposition: attachment`로 응답.
- 파일명: `지급요청리스트_YYYYMMDD.xlsx` (KST 기준, 기존 `payees/export/route.ts`와 동일한 방식으로 날짜 산출).

### `src/app/(app)/expenses/PaymentRequestListPanel.tsx`

- "📗 엑셀 다운로드" 버튼(118~122행)을 `PayeeListPanel` 패턴처럼 교체:
  - `rows.length > 0`이면 `<a href={exportHref}>` 링크로.
  - `exportHref`는 `selected.size > 0`이면 `?ids=${선택된 id들}`, 아니면 현재 `filterValues` 전체를 쿼리스트링으로.
  - `rows.length === 0`이면 `disabled` + `title="다운로드할 데이터가 없습니다"` 버튼.
- 다른 버튼(일괄수정/삭제/등록/엑셀업로드)과 레이아웃/동작은 그대로 둔다.

## 범위 밖 (변경하지 않음)

- 페이지네이션 도입/변경 안 함.
- 감사 로그(다운로드 이력 기록) 도입 안 함.
- `PaymentRequest`/`Payee`의 스냅샷 설계 자체는 변경하지 않는다(사업자명/청구방식을 항상 최신값으로 재조회하도록 바꾸는 것은 이번 범위 밖).
- 등록 서식 다운로드/업로드(`PaymentRequestExcelUploadModal.tsx`, 지급일/여부 재반영용)는 변경하지 않는다.
- `PaymentRequestDetailModal`/`PaymentRequestBulkUpdateModal` 등 다른 스텁("추후 구현 예정") 기능은 이번 범위 밖.

## 테스트 계획

- 단위 테스트(`buildPaymentRequestExportXlsxBuffer`): 헤더 순서/내용, 사업자번호·계좌번호가 텍스트 서식으로 선행 0을 보존하는지, 금액 컬럼이 콤마 서식으로 표시되는지, 지급명의/청구방식이 한글 라벨로 변환되는지.
- 단위 테스트(`listPaymentRequestsForExport`): `ids` 지정 시 필터 무시하고 해당 건만 반환, `ids` 없이 필터만 지정 시 기존 `listPaymentRequests` 필터링과 동일하게 동작(페이지네이션 없이 전체 반환), `payeeId`가 없는 건은 지급 리스트 연동 컬럼이 빈 문자열인지, 사업자번호/계좌번호가 원문으로 복호화되는지.
- 수동 검증: 지급요청 화면에서 체크박스 선택 후 다운로드(선택 건만 포함되는지), 선택 없이 필터 적용 후 다운로드(필터 결과 전체 포함되는지), 검색 결과 0건일 때 버튼 비활성화 확인, 다운로드된 파일에서 사업자번호/계좌번호 원문 및 금액 콤마 서식 확인, 파일명 형식 확인.
