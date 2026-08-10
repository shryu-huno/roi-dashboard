# 지급요청 수정/삭제 — 설계

작성일: 2026-08-04

## 배경

`/expenses` 지급요청(payment-request) 화면은 조회·등록(PM)·엑셀 다운로드·엑셀
재업로드 반영은 실동작하지만, **목록 화면의 수정/삭제 버튼은 전부
`alert("추후 구현 예정입니다.")`로 막혀 있는 자리표시자**다
(`PaymentRequestListPanel.tsx`의 상단 일괄삭제·행별 삭제,
`PaymentRequestBulkUpdateModal.tsx`의 적용, `PaymentRequestDetailModal.tsx`의
저장). 지급리스트(Payee)는 인라인 수정 + 소프트 삭제가 이미 구현되어 있으므로,
그 패턴을 그대로 재사용해 지급요청에도 수정/삭제를 연결한다.

## 요구사항

### 정산담당자(SETTLEMENT/ADMIN)

- 상세보기(🔍) 버튼은 제거한다 — 지급리스트처럼 행 자체를 인라인 편집한다.
- 관리 컬럼은 ✏️(편집) / 🗑️(삭제) 두 아이콘으로 바뀐다.
- ✏️ 편집 시 **지급명의 / 고객사 / 사업자명(이름) / 지급일 / 지급여부** 5개
  필드를 한 번에 수정할 수 있다. 상태(지급준비/지급완료)와 무관하게 항상 수정
  가능하다.
- 사업자명은 텍스트 직접 수정이 아니라 등록 화면과 동일한 `PayeeCombobox`로
  다른 사업자를 재검색/재선택하는 방식이다 — 선택 시 `payeeId`가 교체되고
  `bizName`/`taxType`은 서버가 Payee 레코드에서 다시 조회해 스냅샷으로 갱신한다.
- 삭제는 지급준비/지급완료 관계없이 항상 가능하다(단건/일괄 모두).
- 상단 액션 버튼 순서를 `📗 엑셀 다운로드 → ⬆ 엑셀 업로드 → 🗓️ 수정 → 🗑️ 삭제`
  순으로 바꾼다. "일괄수정" 버튼/모달 제목은 "수정"으로 이름을 바꾼다(기능은
  기존 화면 그대로: 체크박스 선택 → 팝업에서 지급일 달력 + 지급여부 드롭다운 →
  적용 시 선택된 건 전체에 동일하게 반영).

### PM

- 관리 컬럼의 상세보기 아이콘을 🔍에서 ✏️로 바꾼다(지급리스트와 동일 이모지).
  클릭 동작(상세 모달 열기) 자체는 유지한다.
- 지급준비 상태 + 본인이 신청한 건에 한해, 상세 모달에서 **등록 시 작성했던
  전체 항목**(지급명의/고객사/사업자명/단가/교통비/재료비/횟수/상세내역)을
  실제로 수정해 반영할 수 있다. 지급일/지급여부는 여전히 읽기전용(정산담당자
  전담 필드).
- 지급완료 건이거나 타인이 신청한 건은 기존과 동일하게 읽기전용으로만 열람
  가능(저장 버튼 자체가 노출되지 않음).
- 삭제는 지급준비 상태 + 본인 신청 건만 가능하다. 체크박스 일괄삭제도
  지원하되, 비대상 행(지급완료 또는 타인 신청)은 체크박스와 행별 🗑️ 버튼을
  비활성화해 애초에 선택할 수 없게 한다.

### 공통

- 삭제는 지급리스트와 동일하게 **소프트 삭제**(`deletedAt`, 목록에서 숨김,
  데이터 보존)다.
- 삭제 확인은 커스텀 모달에서 한 번 더 확인 후 진행한다(단건/일괄 공용).

## 설계

### 1. 데이터 계층 (`src/lib/data/payment-requests.ts`)

세 함수를 추가한다. 기존 `updatePaymentRequestsBulk`(엑셀 재업로드 전용,
seqNo 기반)은 그대로 두고 건드리지 않는다 — 용도가 다르다.

```ts
// 정산담당자 인라인 수정. payeeId로 Payee를 다시 조회해 bizName/taxType을
// 스냅샷으로 갱신한다(클라이언트가 보낸 bizName은 신뢰하지 않음 — 등록 때와
// 동일 원칙). Payee가 없거나 삭제됐으면 에러.
export async function updatePaymentRequest(
  ctx: RlsContext,
  id: string,
  input: { entity: PaymentRequestEntity; clientId: string; payeeId: string; payDate: Date | null; status: PaymentRequestStatus },
): Promise<ActionState>

// PM 상세수정. amount를 (unitPrice+transportFee+materialFee)*count로
// 재계산한다. payeeId 재조회로 bizName/taxType 갱신은 위와 동일.
// status===PREPARING && requesterId===본인 여부는 호출부(서버 액션)가
// 미리 검증했다고 가정한다(DB RLS가 이 조건을 걸러주지 않으므로 앱 레이어 책임).
export async function updatePaymentRequestPmFields(
  ctx: RlsContext,
  id: string,
  input: { entity: PaymentRequestEntity; clientId: string; payeeId: string; unitPrice: number; transportFee: number; materialFee: number; count: number; memo: string },
): Promise<ActionState>

// 일괄수정(체크박스 선택 → 지급일/지급여부 동일 적용).
export async function updatePaymentRequestsByIds(
  ctx: RlsContext,
  ids: string[],
  input: { payDate: Date | null; status: PaymentRequestStatus },
): Promise<ActionState>

// 소프트 삭제. Payee의 softDeletePayees와 동일한 updateMany 패턴.
// opts.statusIn이 있으면 그 상태의 행만 대상으로 삼는다(PM 삭제 시
// ["PREPARING"]을 넘겨 지급완료 건이 섞여도 삭제되지 않게 막는다).
// 매칭된 count가 ids.length보다 작으면(권한 없는 행이 섞여 있었다는 뜻)
// 부분삭제 대신 전체 실패로 처리한다 — 조용한 부분성공보다 명확한 에러가 낫다.
export async function softDeletePaymentRequests(
  ctx: RlsContext,
  ids: string[],
  opts?: { statusIn?: PaymentRequestStatus[] },
): Promise<ActionState>
```

`updatePaymentRequest`/`updatePaymentRequestPmFields` 공통 로직(Payee 재조회 +
존재 확인)은 작은 내부 헬퍼로 묶어 중복을 줄인다.

### 2. 검증 스키마 (`src/lib/validation/schemas.ts`)

`payeeUpdateSchema`/`payeeUpdatePmSchema` 옆에 추가:

```ts
export const paymentRequestUpdateSchema = z.object({
  entity: z.enum(["HUNO", "HUNO_INC"]),
  clientId: z.string().min(1),
  payeeId: z.string().min(1),
  payDate: z.preprocess((v) => (v === "" ? null : v), z.coerce.date().nullable()),
  status: z.enum(["PREPARING", "COMPLETED"]),
});

export const paymentRequestUpdatePmSchema = z.object({
  entity: z.enum(["HUNO", "HUNO_INC"]),
  clientId: z.string().min(1),
  payeeId: z.string().min(1),
  unitPrice: z.coerce.number().int().min(1),
  transportFee: z.coerce.number().int().min(0),
  materialFee: z.coerce.number().int().min(0),
  count: z.coerce.number().int().min(1),
  memo: z.string(),
});

export const paymentRequestBulkUpdateSchema = z.object({
  payDate: z.preprocess((v) => (v === "" ? null : v), z.coerce.date().nullable()),
  status: z.enum(["PREPARING", "COMPLETED"]),
});
```

### 3. 서버 액션 (`src/app/(app)/expenses/payment-request/actions.ts`)

기존 `uploadPaymentRequestUpdatesAction` 옆에 추가:

```ts
export async function updatePaymentRequestAction(id: string, formData: FormData): Promise<ActionState>
```
`requireRole("SETTLEMENT")` → `paymentRequestUpdateSchema` 파싱 →
`updatePaymentRequest` 호출 → 실패 시 `{ ok:false, error }`, 성공 시
`revalidatePath("/expenses")` + `SAVED`. (`updatePayeeAction`과 동일 뼈대.)

```ts
export async function updatePaymentRequestPmAction(id: string, formData: FormData): Promise<ActionState>
```
`requireRole("PM")` → 대상 행을 조회해 `status === "PREPARING" && requesterId === user.id`
아니면 `{ ok:false, error: "수정할 수 없는 건입니다." }`로 즉시 반환(서버 재검증 —
화면 버튼이 숨겨져 있어도 직접 호출을 막는다) → `paymentRequestUpdatePmSchema`
파싱 → `updatePaymentRequestPmFields` 호출 → 이후 동일.

```ts
export async function bulkUpdatePaymentRequestsAction(ids: string[], formData: FormData): Promise<ActionState>
```
`requireRole("SETTLEMENT")` → `paymentRequestBulkUpdateSchema` 파싱 →
`updatePaymentRequestsByIds` 호출 → 이후 동일.

```ts
export async function deletePaymentRequestsAction(ids: string[]): Promise<ActionState>
```
`requireRole("PM")`(랭크상 전 역할 통과, `deletePayeesAction`과 동일 이유) →
`user.role === "PM"`이면 `softDeletePaymentRequests(ctx, ids, { statusIn: ["PREPARING"] })`,
그 외(ADMIN/SETTLEMENT)면 `softDeletePaymentRequests(ctx, ids)` → 이후 동일.

### 4. UI

#### 4-1. 데이터 흐름 (`page.tsx`)

`PaymentRequestTab`이 이미 `payees = await listPayeeOptions(ctx)`를 조회하고
있으나 `ListPanel`에는 `bizNames`(문자열 배열)만 내려주고 있다. 콤보박스가
필요하므로 `payees` 원본 배열을 `PaymentRequestListPanel`까지 그대로
내려준다(prop 추가, `bizNames`는 필터용으로 계속 유지).

#### 4-2. `PaymentRequestListPanel.tsx`

- 상단 액션 바 버튼 순서 변경: 엑셀 다운로드 → 엑셀 업로드 → 수정(일괄) →
  삭제(일괄). "🗓️ 일괄수정" 라벨을 "🗓️ 수정"으로 변경.
- `PaymentRequestBulkUpdateModal`에 `ids={Array.from(selected)}` 전달(기존
  `count`는 제거, 모달 내부에서 `ids.length`로 표시).
- 삭제 확인 대상 상태 추가: `deleteTarget: string[] | null`(Payee와 동일
  패턴). 상단 삭제 버튼 → `setDeleteTarget(Array.from(selected))`, 행별
  삭제 → `setDeleteTarget([r.id])`.
- 체크박스/행별 관리 렌더링을 role로 분기:
  - `role !== "PM"`(SETTLEMENT/ADMIN): 새 `PaymentRequestRow` 컴포넌트로
    행을 위임(인라인 편집 포함).
  - `role === "PM"`: 기존과 같이 이 파일 안에서 직접 렌더링하되, 관리
    컬럼을 `✏️`(상세 모달 오픈)/`🗑️`로 바꾸고, `pmCanAct = row.status === "PREPARING" && row.requesterId === currentUserId`가
    false면 체크박스와 🗑️를 `disabled`로 표시한다. 전체선택 체크박스도
    PM일 때는 `pmCanAct`인 행만 선택 대상으로 삼는다.
- 편집 중인 행 id 집합(`editing: Set<string>`, Payee의 `PayeeListPanel`과
  동일)을 새로 추가해 `PaymentRequestRow`에 `isEditing`/`onStartEdit`/`onStopEdit`으로
  넘긴다.

#### 4-3. `PaymentRequestRow.tsx` (신규, 정산담당자 전용 인라인 편집 행)

`PayeeRow.tsx`와 동일한 구조(ref 기반 입력값 수집 → `FormData` 조립 →
`useTransition` 안에서 서버 액션 호출 → 성공 시 `router.refresh()` +
`onStopEdit()`, 실패 시 에러 문구 표시)로 작성하되 필드 구성만 다르다:

- 지급명의: `<select ref>` (`PAYMENT_REQUEST_ENTITY_LABELS` 옵션, `PayeeRow`의
  청구방식 select와 동일 패턴).
- 고객사: `PaymentRequestClientCombobox` — `selectedId`/`onSelect`를 로컬
  `useState`로 관리(콤보박스는 ref 기반 텍스트 입력이 아니라 controlled
  컴포넌트라 다른 필드처럼 ref로 값을 꺼낼 수 없음).
- 사업자명: `PayeeCombobox` — 동일하게 `useState`로 `payeeId` 관리.
- 지급일: `<input type="date" ref>`.
- 지급여부: `<select ref>` (`PREPARING`/`COMPLETED`).
- 저장 시 `updatePaymentRequestAction(row.id, formData)` 호출. `clientId`/`payeeId`는
  useState 값을, 나머지는 ref 값을 FormData에 담는다.
- 편집 모드가 아닐 때는 현재 화면과 동일하게 읽기전용 텍스트 + ✏️/🗑️.

#### 4-4. `PaymentRequestBulkUpdateModal.tsx`

- props를 `{ ids: string[]; onClose: () => void; onSuccess: () => void }`로
  변경(`count` prop 제거).
- 내부에 `pending`/`error` 상태를 추가(현재 `payDate`/`status` 로컬 상태에
  이어서). `handleApply`에서 `useTransition` 또는 단순 `async` 핸들러로
  `bulkUpdatePaymentRequestsAction(ids, formData)` 호출 → 성공 시 `onSuccess()`(부모가
  `router.refresh()` + 선택 해제 + 모달 닫기 수행) 실패 시 모달 내부에 에러 표시.
- 제목 "일괄수정" → "수정".

#### 4-5. `PaymentRequestDeleteConfirmModal.tsx` (신규)

`PayeeDeleteConfirmModal.tsx`와 완전히 동일한 구조(props: `open`, `count`,
`pending`, `error`, `onConfirm`, `onCancel`, 동일 문구). 엔티티명 통일을 위해
지급요청 쪽에 별도 파일로 둔다(다른 지급요청 전용 컴포넌트들과 동일한
네이밍 컨벤션 — 예: `PaymentRequestExcelUploadModal`이 `PayeeUploadModal`과
별도 파일인 것과 동일).

`PaymentRequestListPanel`이 `deleteTarget`/`deletePending`/`deleteError` 상태를
소유하고 `handleConfirmDelete`에서 `deletePaymentRequestsAction(deleteTarget)`
호출(Payee의 `PayeeListPanel.handleConfirmDelete`와 동일 패턴).

#### 4-6. `PaymentRequestDetailModal.tsx` (PM 전용으로 전환)

- 정산담당자(`canEditSettlementFields`) 분기를 전부 제거한다 — 정산담당자는
  더 이상 이 모달을 열지 않는다. 지급일/지급여부는 이제 항상 읽기전용으로
  표시.
- `canEditPmFields`(`role === "PM" && row.status === "PREPARING" && row.requesterId === currentUserId`)일
  때 다음 필드를 읽기전용 span 대신 편집 가능한 입력으로 바꾼다:
  - 지급명의: `<select>` (엔티티 라벨).
  - 고객사: `PaymentRequestClientCombobox`.
  - 사업자명: `PayeeCombobox`(선택 시 청구방식도 함께 갱신되어 화면에 반영,
    다만 실제 저장값은 서버가 재조회해 확정).
  - 단가/교통비/재료비/횟수: `PaymentRequestRowsTable`의 숫자 입력과 동일하게
    콤마 포맷 + 숫자만 허용하는 텍스트 입력(`formatThousands`/`computeRowAmount`
    재사용 가능하면 재사용).
  - 상세내역(메모): `<input type="text">`.
  - 지급액은 위 4개 값으로 실시간 재계산해 미리보기로 보여주되(등록 폼과
    동일한 계산식), 실제 저장값은 서버가 다시 계산한다.
- 청구방식(taxType)은 사업자 선택에 종속되므로 별도 입력 UI 없이 선택된
  Payee 기준으로 화면에 표시만 한다(등록 폼과 동일).
- `handleSave`에서 `updatePaymentRequestPmAction(row.id, ...)` 호출, 성공 시
  `router.refresh()` + `onClose()`, 실패 시 에러 표시.
- 콤보박스를 쓰려면 `clients: {id,name,businessType}[]`, `payees: PayeeOption[]`를
  이 모달의 props로 추가해야 한다 — `PaymentRequestListPanel` → 이 모달로
  그대로 전달(4-1에서 이미 `payees`를 받으므로 추가 조회 없음).

### 5. 권한 요약

| 동작 | ADMIN/SETTLEMENT | PM |
|---|---|---|
| 지급명의/고객사/사업자명/지급일/지급여부 인라인 수정 | 언제나 가능 | 불가 |
| 지급명의/고객사/사업자명/단가/교통비/재료비/횟수/상세내역 수정(상세모달) | 해당 없음(모달 자체 없음) | 지급준비 + 본인 신청 건만 |
| 삭제(단건/일괄) | 언제나 가능 | 지급준비 + 본인 신청 건만 |

DB RLS(`payment_request_write_admin`, `payment_request_update_pm`)는
ADMIN/SETTLEMENT의 전체 쓰기 권한과 PM의 `requesterId` 제한까지만 강제하고,
"지급완료 건은 수정/삭제 불가" 같은 상태 기반 제약은 걸러주지 않는다 — 서버
액션(앱 레이어)이 반드시 재검증해야 한다(기존 코드 주석에도 명시된 원칙).

### 6. 에러 처리

- 모든 실패는 throw 없이 `ActionState`(`{ ok:false, error }`)로 반환해 화면에
  표시한다(`updatePayeeAction`/`deletePayeesAction`과 동일 원칙).
- `payeeId`가 가리키는 Payee가 존재하지 않거나 삭제됐으면 "선택한 사업자를
  찾을 수 없습니다. 다시 선택해 주세요." 류의 안내 후 저장 중단(등록 화면의
  `createPaymentRequestsBulk`와 동일한 문구 스타일).
- PM이 지급완료/타인 건 수정·삭제를 서버 액션에 직접 시도하면(버튼이
  숨겨져 있어도 API 직접 호출 등) "수정/삭제할 수 없는 건입니다." 로 거부.

### 7. 테스트 (`test/data-payment-requests.test.ts`)

기존 `listPaymentRequests` 테스트 옆에 추가:

- `updatePaymentRequest`: 정상 수정 후 필드 반영 확인, 존재하지 않는
  payeeId로 시도 시 에러.
- `updatePaymentRequestPmFields`: amount 재계산 확인, payeeId 교체 시
  bizName/taxType 갱신 확인.
- `updatePaymentRequestsByIds`: 여러 id 동시 반영 확인, 존재하지 않는 id
  섞여도 나머지는 반영되는지(이 함수는 엑셀 재업로드처럼 "찾은 것만
  갱신"이지, 삭제처럼 all-or-nothing이 아님 — 설계 의도 확인용 테스트).
- `softDeletePaymentRequests`:
  - 정상 삭제 후 `deletedAt` 채워짐 + `listPaymentRequests` 결과에서 제외.
  - `statusIn: ["PREPARING"]`로 COMPLETED 건 삭제 시도 → 매칭 0건 →
    `ok:false`.
  - 일부는 PREPARING, 일부는 COMPLETED인 id 배열을 `statusIn` 옵션과 함께
    넘기면 전체 실패(부분삭제 없음) 확인.

서버 액션 단위의 role 가드(`requireRole`)는 기존 payees 액션 테스트가
그렇듯 별도 단위테스트 없이 데이터 계층 테스트로 갈음한다(기존 컨벤션).

## 범위 제외

- 엑셀 재업로드 반영(`updatePaymentRequestsBulk`, seqNo 기반)은 이번 변경과
  무관하며 그대로 둔다.
- 삭제된 지급요청을 보는 "보관함"/복원 기능은 만들지 않는다(Payee와 동일하게
  필요 시 추후 확장 가능).
- 지급요청 등록 화면(`PaymentRequestNewForm`/`PaymentRequestRowsTable`) 자체는
  건드리지 않는다 — 상세모달의 PM 편집 UI가 그 화면의 입력 컴포넌트를
  재사용할 뿐, 등록 플로우 자체는 변경 없음.
- 공지사항(`PaymentRequestNoticeBanner`) 관련 기능은 이번 스펙과 무관.
