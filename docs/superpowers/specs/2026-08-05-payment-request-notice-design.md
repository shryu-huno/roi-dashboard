# 지급요청 공지사항 — 설계

작성일: 2026-08-05

## 배경

`/expenses` 지급요청 화면 상단에는 `PaymentRequestNoticeBanner.tsx`가 이미
자리만 잡아둔 상태다(주석: "공지사항 CRUD(정산담당자/관리자 작성)는 다음
단계 스펙에서 구현. 이번 단계는 자리만 배치."). 지금 그 CRUD를 구현한다.

## 요구사항

- 범위는 지급요청 목록(`/expenses?tab=payment-request`) 상단 배너 하나에
  한정한다. 사이트 전체에서 재사용하는 범용 공지사항 시스템은 만들지 않는다.
- 공지는 항상 최대 1개만 존재한다. 새로 저장하면 기존 공지를 덮어쓴다(이력
  보관 없음).
- ADMIN/SETTLEMENT만 작성/수정 가능. PM은 읽기전용.
- 편집은 배너 안에서 인라인으로 이루어진다(별도 모달 없음) — "수정" 버튼
  클릭 시 배너 자리가 textarea + 저장/취소 버튼으로 바뀐다.
- 공지 내용만 표시한다. 작성자/작성일시는 화면에 노출하지 않는다(DB에도
  저장하지 않는다 — YAGNI).
- 내용을 비운 채로 저장하면 공지가 없는 상태로 취급되어 기존 플레이스홀더
  문구("📢 등록된 공지가 없습니다.")가 다시 보인다. 별도의 삭제 버튼/기능은
  두지 않는다.
- 내용 길이 제한은 두지 않는다(코드베이스의 memo류 필드와 동일한 관례).

## 설계

### 1. 데이터 모델 (`prisma/schema.prisma`)

공지가 항상 1개뿐이므로 고정 id(`"singleton"`)의 단일 행만 사용하는
싱글턴 테이블로 둔다. 별도 조회 키/목록이 필요 없어 가장 단순하다.

```prisma
model PaymentRequestNotice {
  id        String   @id @default("singleton")
  content   String   @default("")
  updatedAt DateTime @updatedAt
}
```

RLS는 `PaymentRequest`의 `payment_request_write_admin` 정책과 동일한
형태로 건다(마이그레이션 SQL에서 직접 작성):

```sql
ALTER TABLE "PaymentRequestNotice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentRequestNotice" FORCE ROW LEVEL SECURITY;

CREATE POLICY payment_request_notice_select ON "PaymentRequestNotice"
  FOR SELECT
  USING (true); -- 지급요청 탭 자체가 ADMIN/SETTLEMENT/PM 전용이므로 고객사 스코프 불필요

CREATE POLICY payment_request_notice_write_admin ON "PaymentRequestNotice"
  FOR ALL
  USING (current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT'))
  WITH CHECK (current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT'));
```

DELETE 정책은 두지 않는다 — 항상 upsert로 빈 문자열까지 포함해 갱신한다.

### 2. 데이터 계층 (`src/lib/data/payment-request-notice.ts`, 신규)

```ts
// 공지 내용만 반환(없으면 빈 문자열). 작성자/시각은 요구사항상 노출하지 않으므로
// content만 조회한다.
export async function getPaymentRequestNotice(ctx: RlsContext): Promise<string>

// id 고정(singleton) upsert. 빈 문자열 저장도 허용(= 공지 비우기).
export async function upsertPaymentRequestNotice(
  ctx: RlsContext,
  content: string,
): Promise<ActionState>
```

두 함수 모두 기존 데이터 계층 함수들과 동일하게 `withRLS`를 통해 받은
`Prisma.TransactionClient`(`ctx`를 감싼 트랜잭션)를 사용한다
(`payment-requests.ts`의 다른 함수들과 동일한 시그니처 스타일).

### 3. 검증 스키마 (`src/lib/validation/schemas.ts`)

`paymentRequestUpdateSchema` 근처에 추가:

```ts
export const paymentRequestNoticeSchema = z.object({
  content: z.string().trim(),
});
```

### 4. 서버 액션 (`src/app/(app)/expenses/payment-request/actions.ts`)

```ts
export async function updatePaymentRequestNoticeAction(formData: FormData): Promise<ActionState>
```

`requireRole("SETTLEMENT")`(ADMIN도 랭크상 통과, 기존 다른 액션들과 동일
원칙) → `paymentRequestNoticeSchema` 파싱 → `upsertPaymentRequestNotice`
호출 → 실패 시 `{ ok:false, error }`, 성공 시 `revalidatePath("/expenses")` +
`SAVED`.

### 5. UI

#### 5-1. 데이터 흐름 (`page.tsx`)

`PaymentRequestTab`에서 `getPaymentRequestNotice(ctx)`를 조회해
`PaymentRequestListPanel`에 `noticeContent: string` prop으로 추가 전달한다
(다른 조회들과 `Promise.all`로 묶는다).

#### 5-2. `PaymentRequestListPanel.tsx`

`noticeContent` prop을 받아 그대로 `PaymentRequestNoticeBanner`에 전달한다.
`canEdit = role === "ADMIN" || role === "SETTLEMENT"`도 함께 전달(이미
`role` prop 보유).

#### 5-3. `PaymentRequestNoticeBanner.tsx` (client 컴포넌트로 전환)

```ts
export function PaymentRequestNoticeBanner({
  content,
  canEdit,
}: {
  content: string;
  canEdit: boolean;
})
```

`PaymentRequestRow.tsx`와 동일한 패턴(`useState` + `useTransition` +
`router.refresh()`)으로 작성한다:

- 보기 모드: `content`가 있으면 그대로 표시, 없으면 기존 플레이스홀더
  문구("📢 등록된 공지가 없습니다.") 유지. `canEdit`이면 우측에 "수정"
  버튼.
- 편집 모드(`canEdit`만 진입 가능): 배너 영역이 `<textarea defaultValue={content}>` +
  저장/취소 버튼으로 바뀐다. 저장 시 `updatePaymentRequestNoticeAction`
  호출, 성공하면 `router.refresh()` 후 보기 모드로 복귀, 실패 시 에러
  문구 표시(`PaymentRequestRow`의 에러 표시 패턴과 동일). 취소 시 입력값을
  버리고 보기 모드로 복귀.
- `canEdit`이 아니면(PM) 수정 버튼 자체가 렌더링되지 않는다 — 서버
  액션에서도 `requireRole("SETTLEMENT")`로 이중 방어.

### 6. 테스트

- `test/data-payment-request-notice.test.ts`(신규): `getPaymentRequestNotice`
  최초 조회 시 빈 문자열, `upsertPaymentRequestNotice` 저장 후 재조회 시
  반영 확인, 빈 문자열로 재저장 시 비워지는지 확인.
- RLS 회귀: 같은 파일에서 PM 컨텍스트로 `upsertPaymentRequestNotice` 호출 시
  거부되는지 확인(`test/payee-rls.test.ts`의 PM 쓰기 거부 패턴 참고).
- `test/schemas.test.ts`: `paymentRequestNoticeSchema`에 공백만 있는 입력이
  trim 후 빈 문자열로 통과하는지 케이스 추가.

## 범위 제외

- 공지 작성자/작성일시 저장·표시.
- 공지 이력(과거 공지 목록) 보관.
- 지급요청 탭 외 다른 화면에서 재사용 가능한 범용 공지사항 시스템.
- 내용 길이 제한.
