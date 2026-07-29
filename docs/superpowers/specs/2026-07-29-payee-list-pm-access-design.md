# 지급리스트 PM 접근 권한(마스킹 뷰) — 설계

작성일: 2026-07-29

## 배경

`/expenses` 지급리스트(payees) 탭은 전사 공용 원장이라 지금까지 PM에게는
막혀 있었다(`tabs.ts`: "지급 리스트는 고객사 구분이 없는 전사 공용 원장이라
PM에 열지 않는다"). 이번 요청으로 PM에게도 열어주되, 민감정보는 화면 단위가
아니라 **서버에서부터 마스킹된 값만** 내려준다(RSC 페이로드에 원문을 담지
않는다는 기존 `PayeeRow` 타입의 원칙을 그대로 따름).

## 요구사항

1. PM도 지급 리스트 탭에 접근할 수 있다.
2. PM 화면에서는:
   - "사업자번호(주민등록번호)" 컬럼 대신 **연락처**를 보여주되 중간 4자리만
     마스킹(`010-****-5678`).
   - 은행명/계좌번호/예금주는 **길이 기반 전체 마스킹**(`*`를 값 길이만큼).
3. PM은 등록/삭제/사업자명·청구방식 수정/첨부파일 업로드·교체가 가능하다.
4. PM은 엑셀 다운로드, 첨부파일 다운로드·삭제, 은행명/계좌번호/예금주 수정은
   할 수 없다.

## 설계

### 1. 접근 제어 (`tabs.ts`)

- `payment-list` 탭에 `pmScoped: true` 추가. 안내 주석을 "전사 공용 원장이지만
  PM에게는 마스킹된 뷰로 노출"로 갱신.
- 엑셀 다운로드 라우트(`export/route.ts`)와 첨부파일 다운로드 액션
  (`getAttachmentDownloadUrlAction`)은 `requireRole("SETTLEMENT")` 그대로
  유지 — PM은 URL을 직접 쳐도 차단된다.

### 2. 마스킹 헬퍼 (`src/lib/crypto/payee-secret.ts`)

```ts
// 연락처: 뒤 4자리 앞까지 유지, 중간 4자리만 마스킹. 010-****-5678
export function maskPhone(digits: string): string {
  const headLen = Math.max(digits.length - 8, 0);
  return `${digits.slice(0, headLen)}-****-${digits.slice(-4)}`;
}

// 길이 기반 전체 마스킹(은행명/계좌번호/예금주 공용).
export function maskFully(value: string): string {
  return "*".repeat(value.length);
}
```

계좌번호는 길이를 알아야 하므로 서버에서 `decrypt()`로 복호화한 뒤
`maskFully(digits)`만 사용하고 평문은 버린다(클라이언트로 절대 전달하지 않음).

### 3. 데이터 계층 (`src/lib/data/payees.ts`)

- `fetchMatchedPayees`의 role 가드에 `PM` 추가(ADMIN/SETTLEMENT/PM 모두 원본
  조회까지는 가능 — 마스킹은 이후 매핑 단계에서 역할별로 처리).
- 주의: `fetchMatchedPayees`의 가드를 풀면 `listPayees`/`listPayeesForExport`도
  자체 role 체크가 없어 PM 컨텍스트로 직접 호출 시 원문이 그대로 반환된다.
  이를 막기 위해 `listPayees`와 `listPayeesForExport` 각각에 **별도의**
  `if (ctx.role !== "ADMIN" && ctx.role !== "SETTLEMENT") throw` 가드를 추가한다
  (지금은 이 가드가 `fetchMatchedPayees` 하나에만 있어 암묵적으로 걸려있었음).
  `listPayeesForPm`도 마찬가지로 자체 `PM` 가드를 갖는다(아래 3번 참고). 즉
  세 함수 모두 각자 role을 명시적으로 검증하고, `fetchMatchedPayees`는 "인가된
  역할 중 하나인지"만 최소한으로 확인하는 공용 조회 헬퍼로 남긴다.
- 검색 필드 확장:
  ```ts
  export const PAYEE_SEARCH_FIELDS_PM = ["bizName", "keyId", "phone"] as const;
  export type PayeePmSearchField = (typeof PAYEE_SEARCH_FIELDS_PM)[number];
  export function parsePayeePmSearchField(value?: string): PayeePmSearchField | undefined
  ```
  `PayeeSearchFilter.field` 유니언에 `"phone"` 추가, `fetchMatchedPayees`의
  검색 스위치에 분기 추가:
  ```ts
  if (filter.field === "phone") {
    // 사업자번호 검색과 동일한 이유로 URL 쿼리 노출 위험을 줄이기 위해 앞 6자리까지만 사용.
    const qDigits = digitsOnly(q).slice(0, 6);
    return r.phoneNormalized.includes(qDigits);
  }
  ```
- 신규 타입/함수:
  ```ts
  export type PayeePmRow = {
    id: string;
    keyId: string;
    payeeType: PayeeType;
    bizName: string;
    phoneMasked: string;
    bankNameMasked: string;
    accountNumberMasked: string;
    accountHolderMasked: string;
    taxType: TaxType;
    hasBizCert: boolean;
    hasBankbook: boolean;
  };

  export async function listPayeesForPm(ctx: RlsContext, filter?: PayeeSearchFilter): Promise<PayeePmRow[]> {
    if (ctx.role !== "PM") throw new Error("PM 지급 리스트 조회 권한이 없습니다.");
    const rows = await fetchMatchedPayees(ctx, filter);
    return rows.map((r) => ({
      id: r.id,
      keyId: r.keyId,
      payeeType: r.payeeType,
      bizName: r.bizName,
      phoneMasked: maskPhone(digitsOnly(r.phone)),
      bankNameMasked: maskFully(r.bankName),
      accountNumberMasked: maskFully(decrypt(r.accountNumberEnc)),
      accountHolderMasked: maskFully(r.accountHolder),
      taxType: r.taxType,
      hasBizCert: r.attachments.some((a) => a.fileType === "BIZ_CERT"),
      hasBankbook: r.attachments.some((a) => a.fileType === "BANKBOOK"),
    }));
  }
  ```
- 신규 부분 수정 함수(사업자명/청구방식만):
  ```ts
  export type PayeeUpdatePmInput = { bizName: string; taxType: TaxType };

  export function updatePayeePmFields(ctx: RlsContext, id: string, input: PayeeUpdatePmInput): Promise<void> {
    return withRLS(ctx, async (tx) => {
      if (ctx.role !== "PM") throw new Error("PM 지급 리스트 수정 권한이 없습니다.");
      await tx.payee.update({ where: { id }, data: { bizName: input.bizName, taxType: input.taxType } });
    });
  }
  ```
  은행명/계좌번호/예금주 필드는 `data`에 포함하지 않으므로 기존 값이 그대로
  유지된다.

### 4. 검증 스키마 (`src/lib/validation/schemas.ts`)

```ts
export const payeeUpdatePmSchema = z.object({
  bizName: z.string().min(1, "이름은 필수입니다."),
  taxType: z.enum(TAX_TYPE_LABELS),
});
```
(`payeeUpdateSchema`의 `bizName`/`taxType` 규칙 재사용)

### 5. 서버 액션

**`src/app/(app)/expenses/payees/actions.ts`**
- `uploadPayeesAction`, `deletePayeesAction`: `requireRole("SETTLEMENT")` →
  `requireRole("PM")`로 완화(ADMIN/SETTLEMENT는 랭크상 그대로 통과).
- 신규 `updatePayeePmAction(id, formData)`:
  ```ts
  export async function updatePayeePmAction(id: string, formData: FormData): Promise<ActionState> {
    const user = await requireRole("PM");
    const ctx = getRlsContext(user);
    const parsed = payeeUpdatePmSchema.safeParse({
      bizName: formData.get("bizName"),
      taxType: formData.get("taxType"),
    });
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
    try {
      await updatePayeePmFields(ctx, id, { bizName: parsed.data.bizName, taxType: TAX_TYPE_BY_LABEL[parsed.data.taxType] });
    } catch (e) {
      console.error("[payee update-pm] 수정 실패:", e);
      return { ok: false, error: "수정 중 오류가 발생했습니다. 잠시 후 다시 시도하세요." };
    }
    revalidatePath("/expenses");
    return SAVED;
  }
  ```
- 기존 `updatePayeeAction`(전체 필드 수정, ADMIN/SETTLEMENT 전용)은 변경 없음.

**`src/app/(app)/expenses/payees/attachment-actions.ts`**
- `getPayeeAttachmentsAction`, `saveAttachmentsAction`: `requireRole("SETTLEMENT")`
  → `requireRole("PM")`로 완화.
- `saveAttachmentsAction`에서 `user.role === "PM"`이면 `saveAttachmentsCore` 호출
  전에 `formData`의 `bizCertDelete`/`bankbookDelete` 키를 제거해 서버에서
  삭제 요청을 무시한다(클라이언트가 hidden input을 조작해도 무력화).
- `getAttachmentDownloadUrlAction`은 `requireRole("SETTLEMENT")` 그대로 유지.

### 6. UI

**`page.tsx`** — `PaymentListTab`에서 `user.role === "PM"`이면
`listPayeesForPm` + `parsePayeePmSearchField`로 조회하고 신규
`PayeePmListPanel`을 렌더링, 그 외(ADMIN/SETTLEMENT)는 기존 로직 그대로.

**신규 `PayeePmListPanel.tsx`** (`PayeeListPanel.tsx` 골격 재사용)
- 검색 셀렉트 옵션: 사업자명(이름)/고유번호/연락처(사업자번호 옵션 없음).
- 상단 액션 바: 엑셀 다운로드 버튼/링크 없음. 삭제·등록 버튼은 동일하게 유지.
- 테이블 헤더: 고유번호 / 사업자명(이름) / 연락처 / 은행명 / 계좌번호 / 예금주
  / 청구방식 / 첨부파일 / 관리.
- 행 렌더링은 신규 `PayeePmRow` 사용, 나머지(체크박스 선택, 삭제 확인 모달,
  등록 모달) 로직은 `PayeeListPanel`과 동일하게 재사용.

**신규 `PayeePmRow.tsx`** (`PayeeRow.tsx` 골격 재사용)
- 표시: `keyId`, `bizName`, `phoneMasked`, `bankNameMasked`,
  `accountNumberMasked`, `accountHolderMasked`, `TaxBadge`, 첨부 배지, 관리 버튼.
- 편집 모드: **사업자명 입력창 + 청구방식 셀렉트만** 활성화. 은행명/계좌번호/
  예금주 셀은 편집 모드에서도 마스킹 텍스트를 그대로 고정 표시(입력창 없음).
- 저장 시 `updatePayeePmAction(row.id, formData)` 호출(`bizName`, `taxType`만
  전송).
- 삭제 버튼은 기존과 동일하게 `onRequestDelete` → 부모의 `deletePayeesAction`
  흐름 재사용.
- 첨부 버튼: 기존 `PayeeAttachmentModal`을 `canDownload={false} canDelete={false}`로
  연다.

**`PayeeAttachmentModal.tsx` 수정**
- `canDownload`/`canDelete` prop 추가(기본값 `true`로 ADMIN/SETTLEMENT 기존
  동작 100% 유지).
- `AttachmentSlot`에 두 prop을 전달: 기존 파일이 있을 때 `canDownload=false`면
  "다운로드" 버튼 숨김, `canDelete=false`면 "삭제" 버튼과 "삭제 예정" 흐름 전체
  숨김(변경/업로드만 가능).

### 7. 테스트

- `test/payee-secret.test.ts`: `maskPhone`(길이 9/10/11자리), `maskFully` 케이스
  추가.
- `test/data-payees.test.ts`:
  - `listPayeesForPm` — PM 아닌 역할 거부, 반환값이 실제로 마스킹돼 있는지
    (원문 미포함), 연락처/은행명/계좌번호/예금주 마스킹 형식 검증.
  - `updatePayeePmFields` — PM 아닌 역할 거부, bizName/taxType만 바뀌고
    bankName/accountNumber/accountHolder는 그대로인지 검증.
- `test/schemas.test.ts`: `payeeUpdatePmSchema` 유효/무효 케이스.
- `test/nav.test.ts`(또는 tabs 테스트 위치): PM이 `payment-list` 탭에
  접근 가능해졌는지(`canAccessExpenseTab`, `visibleExpenseTabs`) 갱신.
- `test/rbac.test.ts` / 관련 액션 테스트: `uploadPayeesAction`,
  `deletePayeesAction`, `getPayeeAttachmentsAction`, `saveAttachmentsAction`이
  PM도 통과시키는지, `getAttachmentDownloadUrlAction`과 엑셀 export는 여전히
  PM을 막는지 확인.

## 범위 제외

- PM의 지급 리스트는 여전히 전사 전체 데이터(고객사 스코프 없음)를 보여준다 —
  이번 요청은 필드 마스킹이지 데이터 범위 축소가 아니다.
- 계좌번호 등 마스킹 규칙을 관리자 화면(`PayeeRow`/`listPayees`)에 적용하는
  변경은 없음 — ADMIN/SETTLEMENT는 기존 그대로 원문을 본다.
