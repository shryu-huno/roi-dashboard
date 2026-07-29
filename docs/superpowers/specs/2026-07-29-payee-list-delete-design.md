# 지급리스트 삭제(소프트 삭제) — 설계

작성일: 2026-07-29

## 배경

`/expenses` 지급리스트(payees) 화면은 등록·검색·인라인 수정·첨부파일 관리는
가능하지만 **삭제 기능이 없다**. 체크박스 선택(현재는 엑셀 다운로드 대상 선택에만
쓰임)과 인라인 편집 UI는 이미 있어 이를 재사용해 삭제 기능을 추가한다.

## 요구사항

- 체크박스로 개별 또는 다수 항목을 선택해 삭제할 수 있다.
- 삭제는 즉시 반영되지 않고, 커스텀 확인 모달에서 한 번 더 확인 후 진행한다.
- 삭제 방식: **소프트 삭제**(목록에서 숨김, 데이터는 보존). Client 모델의
  `deletedAt` 패턴을 그대로 따른다.
- 권한: 기존 수정(`updatePayeeAction`)과 동일하게 **SETTLEMENT/ADMIN**.
- 개별 삭제 버튼은 각 행의 편집(✏️) 버튼 옆에 배치한다.

## 설계

### 1. 스키마 + 마이그레이션

- `Payee`에 `deletedAt DateTime?` 추가 (null = 활성, 타임스탬프 = 삭제됨).
- 새 마이그레이션 1개 생성 (`add_payee_deleted_at`).
- `PayeeAttachment`는 `onDelete: Cascade`이지만 소프트 삭제는 `UPDATE`이므로
  실제 삭제 SQL이 돌지 않는다 — 첨부 레코드/스토리지 파일은 그대로 남는다
  (복원 가능성을 열어두는 것과 일치하며, 별도 정리 로직 불필요).

### 2. 데이터 계층 (`src/lib/data/payees.ts`)

- `fetchMatchedPayees`(listPayees/listPayeesForExport 공통 조회)의
  `tx.payee.findMany` 조건에 `where: { deletedAt: null }` 추가 → 삭제된 행이
  목록·검색·엑셀 다운로드 어디에도 노출되지 않는다.
- 신규 함수:
  ```ts
  export async function softDeletePayees(ctx: RlsContext, ids: string[]): Promise<ActionState>
  ```
  - role 체크(ADMIN/SETTLEMENT 아니면 throw, `updatePayee`와 동일 문구 스타일).
  - `updateMany({ where: { id: { in: ids }, deletedAt: null }, data: { deletedAt: new Date() } })`.
  - `count === 0` → `{ ok: false, error: "삭제할 항목을 찾을 수 없습니다." }`, 그 외 `{ ok: true }`.
  - 개별/일괄 삭제 모두 이 함수 하나로 처리(ids 배열 길이 1 또는 N).

### 3. 서버 액션 (`src/app/(app)/expenses/payees/actions.ts`)

```ts
export async function deletePayeesAction(ids: string[]): Promise<ActionState>
```
`updatePayeeAction`과 동일한 뼈대: `requireRole("SETTLEMENT")` → `getRlsContext`
→ `softDeletePayees` 호출을 try/catch로 감싸 실패 시 `{ ok:false, error }` 반환
→ 성공 시 `revalidatePath("/expenses")` → `SAVED` 반환.

### 4. UI

**확인 모달** — 신규 파일 `PayeeDeleteConfirmModal.tsx`. `PayeeAttachmentModal`과
동일한 오버레이 스타일(`fixed inset-0 z-50 ... bg-black/40`, 패널
`rounded-[14px] bg-[var(--color-surface)] p-6 shadow-xl`).

Props: `open`, `count`(삭제 대상 개수), `pending`, `error`, `onConfirm`, `onCancel`.
문구: "{count}건을 삭제하시겠습니까? 삭제된 항목은 목록에서 숨겨집니다." 취소/삭제
버튼, 실패 시 에러 메시지 표시.

**개별 삭제** (`PayeeRow.tsx`) — 관리 컬럼의 ✏️ 옆에 🗑️ 버튼 추가(편집 모드가
아닐 때만 노출). 클릭 시 행 내부 로컬 상태(`useState`)로 확인 모달을 띄우고,
확정하면 `deletePayeesAction([row.id])` 호출 → 성공 시 `router.refresh()` + 모달
닫기, 실패 시 모달에 에러 표시.

**일괄 삭제** (`PayeeListPanel.tsx`) — 상단 우측 액션 바(엑셀 다운로드/등록
버튼 옆)에 "🗑️ 삭제" 버튼 추가. `selected.size === 0`이면 비활성화, 선택된
경우 "🗑️ 삭제 (N건 선택)" 형태로 표시. 클릭 시 확인 모달, 확정하면
`deletePayeesAction(Array.from(selected))` 호출 → 성공 시 `selected` 초기화 +
`router.refresh()` + 모달 닫기, 실패 시 에러 표시.

### 5. 에러 처리

- 삭제 실패는 throw 없이 `ActionState`로 반환해 모달 내부에 표시
  (`updatePayeeAction` 패턴과 동일).
- 권한 없는 역할이 액션을 직접 호출해도 `requireRole`이 차단(기존과 동일).

### 6. 테스트 (`test/data-payees.test.ts`)

`updatePayee` 테스트 옆에 `softDeletePayees` 테스트 추가:
- 정상 삭제 후 `deletedAt`이 채워짐.
- 이미 삭제된 항목을 다시 삭제 시도 → count 0 → `ok:false`.
- SETTLEMENT/ADMIN 외 역할(PM 등) 거부.
- 삭제 후 `listPayees` 결과에서 제외됨을 확인.
- 여러 id를 한 번에 삭제(일괄 삭제) 시 모두 반영됨을 확인.

## 범위 제외

- 삭제된 항목을 보는 "보관함" 화면이나 복원(restore) 기능은 이번 요청에 없어
  만들지 않는다. 스키마가 소프트 삭제이므로 필요 시 Client 패턴
  (`listArchivedClients`/`restoreClient`)을 참고해 추후 추가 가능.
- `PayeeAttachment`/Supabase Storage 파일의 별도 정리(하드 삭제)는 하지 않는다.
