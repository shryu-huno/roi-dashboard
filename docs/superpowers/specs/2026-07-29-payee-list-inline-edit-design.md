# 지급 리스트 인라인 수정 기능 설계

날짜: 2026-07-29
관련: [[2026-07-28-payee-list-search-design]], [[2026-07-29-payee-list-export-design]]

## 배경

지급 리스트 화면(`PayeeListPanel.tsx`)에는 엑셀 업로드로 신규 등록하는 기능만 있고,
등록된 항목을 개별 수정하는 기능은 없다. 화면에는 연필 아이콘 → 인풋 전환, 저장/취소
버튼 UI가 이미 만들어져 있지만 "저장"이 실제로는 편집 모드만 끄고 DB에 반영하지 않는다.
이 작업은 그 저장 동작을 실제로 구현한다.

체크박스 기반 선택 삭제/일괄 작업은 이번 범위에 포함하지 않는다(다음 단계).

## 범위

### 편집 가능 필드

- 사업자명(`bizName`)
- 은행명(`bankName`) — 드롭다운
- 계좌번호(`accountNumber`)
- 예금주(`accountHolder`)
- 청구방식(`taxType`) — 드롭다운 (신규 추가)

### 편집 불가 필드

- 고유번호(`keyId`) — 채번 값, 불변
- 사업자번호/주민등록번호 — 민감정보. 기존 코드 주석에도 "편집 모드에서도 읽기 전용"으로
  명시돼 있다. 마스킹 표시만 유지.

### 기존 이슈 대응: 은행명 드롭다운 안전장치

`BANKS` 하드코딩 목록(국민은행 등 8개) 중에 없는 은행명이 DB에 저장돼 있으면(과거 데이터,
수기 입력 등) `<select defaultValue={r.bankName}>`가 일치하는 옵션을 못 찾아 브라우저가
말없이 첫 번째 옵션을 선택한 상태로 렌더링한다. 지금까지는 저장이 안 됐으니 무해했지만,
이번에 저장이 실제로 동작하면 사용자가 저장 버튼만 눌러도 은행명이 조용히 바뀌는 사고가
날 수 있다. → 현재 값이 `BANKS`에 없으면 옵션 목록 맨 앞에 그 값을 추가해서 select가
항상 현재 값을 정확히 반영하도록 한다.

## 설계

### 1. 데이터 계층 — `src/lib/data/payees.ts`

```ts
export type PayeeUpdateInput = {
  bizName: string;
  bankName: string;
  accountNumber: string; // 평문 숫자
  accountHolder: string;
  taxType: TaxType;
};

export function updatePayee(ctx: RlsContext, id: string, input: PayeeUpdateInput): Promise<void>
```

- `fetchMatchedPayees`와 동일하게 `ctx.role`이 `ADMIN`/`SETTLEMENT`가 아니면 에러.
- `accountNumber`는 `digitsOnly` → `encrypt` → `maskAccountNumber`로 재계산 후 저장
  (업로드 경로와 동일한 변환).
- `bizName`/`bankName`/`accountHolder`/`taxType`는 그대로 저장.
- `bizNumberEnc`/`bizNumberMasked`/`bizNumberBidx`/`keyId`/`payeeType`은 건드리지 않는다.

### 2. 검증 — `src/lib/validation/schemas.ts`

기존 `payeeUploadRowSchema`의 필드별 규칙을 재사용해 `payeeUpdateSchema` 추가:

```ts
export const payeeUpdateSchema = z.object({
  bizName: z.string().min(1, "이름은 필수입니다."),
  bankName: z.string().min(1, "은행명은 필수입니다."),
  accountNumber: accountField, // 숫자 10~16자리 (기존 정의 재사용)
  accountHolder: z.string().min(1, "예금주는 필수입니다."),
  taxType: z.enum(TAX_TYPE_LABELS),
});
```

`BANKS` 목록은 현재 `PayeeListPanel.tsx`에만 정의돼 있어 서버 검증에서 재사용할 수 없다.
`src/lib/labels.ts`로 이동해 클라이언트(드롭다운 옵션)와 서버(선택지 유효성) 양쪽에서
같은 목록을 참조하게 한다. (단, 위의 "안전장치"로 인해 서버는 `BANKS` 목록 밖의 값도
허용해야 한다 — 기존 값을 그대로 다시 제출하는 경우를 막지 않기 위해. 따라서 `bankName`은
`BANKS` enum이 아니라 `min(1)` 문자열 검증으로 둔다.)

### 3. 서버 액션 — `src/app/(app)/expenses/payees/actions.ts`

```ts
export async function updatePayeeAction(id: string, formData: FormData): Promise<ActionState>
```

- `requireRole("SETTLEMENT")`로 권한 체크(업로드 액션과 동일).
- `payeeUpdateSchema.safeParse`로 검증 실패 시 `{ ok: false, error: <첫 메시지> }` 반환.
- `updatePayee` 호출, 실패 시 catch해서 `{ ok: false, error: "수정 중 오류가 발생했습니다..." }`
  (throw로 클라이언트가 깨지지 않게, 업로드 액션과 동일 패턴).
- 성공 시 `revalidatePath("/expenses")` 후 `SAVED` 반환.

### 4. 클라이언트 UI

- `PayeeListPanel.tsx`의 `<tr>` 렌더링 부분을 `PayeeRow.tsx`로 분리한다. 각 행이 독립적으로
  저장 중(pending)/에러 상태를 가져야 하기 때문 — 한 컴포넌트에 다 두면 한 행 저장 중일 때
  다른 행 상태와 얽힌다.
- 인풋은 지금처럼 비제어(`defaultValue` + `ref`) 방식 유지. "저장" 클릭 시 각 ref의 값을
  모아 `FormData`를 만들고 `startTransition(() => updatePayeeAction(r.id, formData))` 호출.
  (`<table>` 구조상 여러 `<td>`를 `<form>`으로 감쌀 수 없어 서버 액션을 직접 호출하는 방식을
  쓴다 — `PayeeUploadModal`처럼 `<form action={...}>` 패턴은 여기선 적용 불가.)
- 성공: `router.refresh()` 호출 후 편집 모드 종료.
- 실패: 편집 모드 유지, 행 아래(또는 관리 셀 안)에 에러 메시지 표시, 저장 버튼은
  `pending` 동안 "저장 중..." + disabled.
- "취소"는 기존 그대로 — 편집 모드만 끄면 인풋이 언마운트되고 원래 `r` 값으로 되돌아간다
  (저장 안 했으므로 `r`이 안 바뀜 → 현재 동작 그대로 유지, 변경 불필요).

### 5. 테스트

- `updatePayee`: 정상 케이스(값이 올바르게 갱신되는지), 권한 없는 role일 때 에러.
- `payeeUpdateSchema`: 잘못된 계좌번호 자릿수, 빈 이름/예금주, 잘못된 청구방식 라벨 거부.
- (수동) 브라우저에서 은행명이 `BANKS` 목록 밖인 기존 데이터로 편집 진입 시 select가 원래
  값을 유지하는지 확인.

## 비범위 (Out of scope)

- 체크박스 기반 다건 선택 삭제/일괄 수정.
- 삭제 기능.
- 연락처(`phone`) 편집 — 목록 화면에 컬럼 자체가 없음.
- 사업자번호/주민등록번호 수정.
