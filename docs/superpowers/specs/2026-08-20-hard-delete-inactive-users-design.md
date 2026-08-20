# 비활성 계정 하드 삭제 기능

- 작성일: 2026-08-20
- 상태: 승인됨

## 배경 / 목적

현재 사용자 관리(`/admin/users`)에서는 계정을 **비활성화(소프트 삭제, `status = INACTIVE`)**만 할 수 있다. 비활성화된 계정을 DB에서 완전히 제거하는 **하드 삭제** 기능을 추가한다. 하드 삭제는 이미 비활성화된 계정에만 허용하며, 최고관리자(`SUPER_ADMIN`) 전용이다.

## 핵심 결정: 지급요청(PaymentRequest) 이력 처리

`PaymentRequest.requester`는 현재 `requesterId String`(필수) + `onDelete` 미지정이라 기본 동작이 **Restrict**다. 따라서 지급요청 이력이 있는 사용자는 DB가 하드 삭제를 물리적으로 거부한다.

**결정: 신청인 연결만 해제(SetNull).** 지급요청 레코드(재무 이력)는 보존하되, 삭제된 사용자를 신청인으로 참조하던 값을 `null`로 만든다. 화면에서는 신청인을 `(삭제된 사용자)`로 표시한다.

이를 위해 관계를 선택적(nullable + `onDelete: SetNull`)으로 변경한다. 그러면 사용자 하드 삭제 시 모든 정리가 DB FK 레벨에서 원자적으로 처리된다:

| 관계 | 모델 | onDelete | 하드 삭제 시 |
|------|------|----------|--------------|
| managedClients | ClientManager | Cascade | 배정 자동 삭제 |
| managedProjects | ProjectManager | Cascade | 배정 자동 삭제 |
| accounts | Account | Cascade | OAuth 계정 자동 삭제 |
| sessions | Session | Cascade | 세션 자동 삭제 |
| team | Team | SetNull | (해당 없음 — User→Team) |
| paymentRequests | PaymentRequest | **SetNull (신규)** | requesterId → null, 레코드 보존 |

앱 코드에서 연관 레코드를 수동 삭제하는 로직이 필요 없다.

## 변경 사항

### 1. 스키마 마이그레이션 (`prisma/schema.prisma`)

```prisma
// PaymentRequest
requesterId  String?
requester    User?   @relation(fields: [requesterId], references: [id], onDelete: SetNull)
```

`roi_app` 역할에 CREATEDB 권한이 없으므로 마이그레이션 SQL을 **직접 작성**해 `migrate deploy`로 적용한다. 내용:

- `ALTER TABLE "PaymentRequest" ALTER COLUMN "requesterId" DROP NOT NULL;`
- 기존 FK 제약 DROP 후 `ON DELETE SET NULL`로 재생성.

`prisma generate`는 개발 서버를 중단한 뒤 실행한다.

### 2. 데이터/액션 계층 (`src/app/(app)/admin/users/actions.ts`)

기존 `applyStatus` / `changeStatus` 패턴을 미러링해 추가한다.

```ts
// 코어(세션 비의존, 테스트 대상): INACTIVE인 경우에만 삭제
export async function applyHardDelete(input: { userId: string }) {
  const result = await prisma.user.deleteMany({
    where: { id: input.userId, status: "INACTIVE" },
  });
  if (result.count === 0) return { ok: false, error: "비활성 사용자를 찾을 수 없습니다." };
  return { ok: true };
}

// 폼 server action (최고관리자 전용)
export async function hardDeleteUser(formData: FormData) {
  await requireRole("SUPER_ADMIN");
  await applyHardDelete({ userId: String(formData.get("userId")) });
  revalidatePath("/admin/users");
}
```

`where`의 `status: "INACTIVE"` 조건으로 활성 계정 삭제를 쿼리 레벨에서 원천 차단한다(`hardDeleteClient`의 `deletedAt: { not: null }` 방어와 동일 패턴).

### 3. UI

- 신규 클라이언트 컴포넌트 `src/app/(app)/admin/users/DeleteUserButton.tsx` — 기존 `DeleteClientButton.tsx`를 미러링. `confirm()` 확인창 1회.
  - 확인 문구: `'{이메일}' 계정을 완전히 삭제하시겠습니까?\n되돌릴 수 없습니다.`
- `src/app/(app)/admin/users/page.tsx` — `status === "INACTIVE"`일 때만 "완전 삭제"(danger 색) 버튼 노출.

### 4. 파급 대응 (`src/lib/data/payment-requests.ts`)

`requester`가 null일 수 있으므로:

- 신청인 매핑 2곳(목록 `listPaymentRequests`, 엑셀 `listPaymentRequestsForExport`):
  ```ts
  requesterName: r.requester?.name ?? r.requester?.email ?? "(삭제된 사용자)",
  ```
- 행 타입 `PaymentRequestRow.requesterId`를 `string`에서 `string | null`로 변경.
- 소비 측 클라이언트 컴포넌트(`PaymentRequestListPanel`, `PaymentRequestRow`, `PaymentRequestDetailModal`)의 `row.requesterId === currentUserId`(PM 편집 권한 판정)는 null 비교로도 정상 동작 → 수정 불필요. 삭제된 신청인의 요청은 자연히 PM 편집 대상에서 제외된다.

## 권한

- 사용자 관리와 동일하게 `SUPER_ADMIN` 전용(`requireRole("SUPER_ADMIN")`).

## 구현 리스크 (계획 단계에서 검증)

- **RLS DELETE 권한**: 소프트 삭제는 `User` UPDATE라 통과했으나 하드 삭제는 DELETE다. `roi_app` 역할에 `User` 테이블 DELETE 권한/RLS 정책이 있는지 확인하고 없으면 마이그레이션에 추가한다. (자식 테이블 Cascade/SetNull은 시스템 레벨이라 RLS 무관)

## 성공 기준

- 비활성(`INACTIVE`) 계정에만 "완전 삭제" 버튼이 노출된다.
- 지급요청 이력이 있는 비활성 계정도 하드 삭제되며, 해당 지급요청 레코드는 보존되고 신청인이 `(삭제된 사용자)`로 표시된다.
- 활성/대기 계정은 하드 삭제되지 않는다(쿼리 레벨 차단).
- 신청인이 삭제되어 `requesterId = null`이 된 지급요청은 PM 편집 대상에서 제외된다(앱의 `updatePaymentRequestPmFields`와 RLS `payment_request_update_pm` 모두 `requesterId = 본인`을 요구하므로 자연히 불일치). 정산담당자·관리자는 계속 편집 가능하며, 목록·엑셀 조회에는 영향이 없다. — 신청인이 사라진 건의 의도된 동작.
- `applyHardDelete` 코어에 대한 단위 테스트: INACTIVE 삭제 성공 / ACTIVE·미존재 시 `{ ok: false }`.
