# 지급요청 등록 화면 다듬기 + 정산담당자 등록 제거 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PM 지급요청 등록 화면(`/expenses/payment-request/new`)의 라벨/전체선택/컬럼너비를 다듬고, SETTLEMENT/ADMIN의 "등록" 팝업을 제거해 "엑셀 업로드"(지급일/지급여부 재반영, 스텁) 버튼으로 대체한다.

**Architecture:** 기존 컴포넌트(`PaymentRequestNewForm`, `PaymentRequestRowsTable`, `PaymentRequestListPanel`)를 그 자리에서 수정한다. 신규 파일은 `PaymentRequestExcelUploadModal.tsx` 하나뿐 — 기존 `PayeeUploadModal.tsx`와 같은 형태(드롭존+안내문구+실행버튼)이되 서버 액션 없이 스텁으로 둔다. `PaymentRequestRegisterModal.tsx`는 사용처가 없어지므로 삭제한다.

**Tech Stack:** Next.js 16(App Router, RSC), React 19, TypeScript, Tailwind.

## Global Constraints

- 이번 계획은 UI/구조 변경만 다룬다 — 데이터 모델/RLS/서버 액션 변경 없음.
- 실제 엑셀 파싱·업로드 반영 로직은 범위 밖. "업로드 실행" 클릭 시 `alert("추후 구현 예정입니다.")`만 띄운다(기존 프로젝트 전반의 스텁 관례와 동일).
- 자동 테스트 대상 아님 — 레포 관례상 React 컴포넌트 자동 테스트가 없다(`vitest.config.ts`가 `environment: "node"`). 각 태스크는 `npx tsc --noEmit`와 수동 검증(`npm run dev`)으로 확인한다.
- 참고 설계 문서: `docs/superpowers/specs/2026-07-30-payment-request-new-form-ui-polish-design.md`, `docs/superpowers/specs/2026-07-30-payment-request-settlement-register-removal-design.md`.
- 커밋은 태스크 단위로 나눈다.

---

## Task 1: 라벨 정리 — "엑셀 업로드(예외건)" / "지급액(자동)"

**Files:**
- Modify: `src/app/(app)/expenses/PaymentRequestNewForm.tsx`
- Modify: `src/app/(app)/expenses/PaymentRequestRowsTable.tsx`

**Interfaces:** 없음(텍스트만 변경, props/함수 시그니처 영향 없음).

- [ ] **Step 1: `PaymentRequestNewForm.tsx`의 버튼 라벨 변경**

`old_string`:
```tsx
          <button type="button" onClick={handleExcelUpload} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">
            엑셀 업로드(예외건)
          </button>
```

`new_string`:
```tsx
          <button type="button" onClick={handleExcelUpload} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">
            엑셀 업로드
          </button>
```

- [ ] **Step 2: 같은 파일의 안내 문구도 동일하게 정리**

`old_string`:
```tsx
      <p className="mb-3 text-xs text-[var(--color-muted)]">
        지급 리스트에 등록된 대상은 사업자명(이름)에서 검색해 선택하세요. 지급 리스트에 없는 예외 건은
        &quot;엑셀 업로드(예외건)&quot;로 등록합니다.
      </p>
```

`new_string`:
```tsx
      <p className="mb-3 text-xs text-[var(--color-muted)]">
        지급 리스트에 등록된 대상은 사업자명(이름)에서 검색해 선택하세요. 지급 리스트에 없는 예외 건은
        &quot;엑셀 업로드&quot;로 등록합니다.
      </p>
```

- [ ] **Step 3: `PaymentRequestRowsTable.tsx`의 헤더 라벨 변경**

`old_string`:
```tsx
              <th className="px-2 py-2">지급액(자동)</th>
```

`new_string`:
```tsx
              <th className="px-2 py-2">지급액</th>
```

- [ ] **Step 4: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 5: 수동 검증**

Run: `npm run dev` → PM 계정으로 `/expenses/payment-request/new` 진입 → "엑셀 업로드" 버튼/안내문구, "지급액" 헤더에 괄호가 없는지 확인.

- [ ] **Step 6: 커밋**

```bash
git add "src/app/(app)/expenses/PaymentRequestNewForm.tsx" "src/app/(app)/expenses/PaymentRequestRowsTable.tsx"
git commit -m "$(cat <<'EOF'
fix(payment-request): 등록 화면 라벨 정리(엑셀 업로드/지급액)

"엑셀 업로드(예외건)" -> "엑셀 업로드", "지급액(자동)" -> "지급액".

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 행 편집기 전체선택 체크박스

**Files:**
- Modify: `src/app/(app)/expenses/PaymentRequestRowsTable.tsx`

**Interfaces:** 없음 — `PaymentRequestRowsTable` 내부 상태(`selected`)만 확장, 외부 props 시그니처 불변.

- [ ] **Step 1: `allSelected`/`toggleSelectAll` 추가**

`old_string`:
```tsx
  function toggleSelect(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function removeSelected() {
```

`new_string`:
```tsx
  const allSelected = rows.length > 0 && selected.size === rows.length;

  function toggleSelect(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.key)));
  }

  function removeSelected() {
```

- [ ] **Step 2: "선택" 헤더를 체크박스로 교체**

`old_string`:
```tsx
              <th className="w-10 px-2 py-2">선택</th>
```

`new_string`:
```tsx
              <th className="w-10 px-2 py-2">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} aria-label="전체선택" />
              </th>
```

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 4: 수동 검증**

Run: `npm run dev` → 등록 화면에서 행 여러 개 추가 → 헤더 체크박스 클릭 시 전체 선택/해제됨 → 일부 행만 체크하면 헤더 체크박스는 미선택 상태로 보임 → 전체선택 후 "- 행 삭제"로 한 번에 삭제됨.

- [ ] **Step 5: 커밋**

```bash
git add "src/app/(app)/expenses/PaymentRequestRowsTable.tsx"
git commit -m "$(cat <<'EOF'
feat(payment-request): 등록 행 편집기 전체선택 체크박스 추가

기존 selected 상태를 재사용해 헤더 체크박스로 전체 선택/해제 지원.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 행 편집기 컬럼 너비 재배치

**Files:**
- Modify: `src/app/(app)/expenses/PaymentRequestRowsTable.tsx`

**Interfaces:** 없음 — 스타일 클래스만 변경.

- [ ] **Step 1: 좁아야 할 컬럼에 명시적 너비 클래스 적용**

`old_string`:
```tsx
              <th className="w-10 px-2 py-2">No</th>
              <th className="px-2 py-2">지급명의</th>
              <th className="px-2 py-2">고객사</th>
              <th className="px-2 py-2">사업자명(이름)</th>
              <th className="px-2 py-2">단가</th>
              <th className="px-2 py-2">교통비</th>
              <th className="px-2 py-2">재료비</th>
              <th className="px-2 py-2">횟수</th>
              <th className="px-2 py-2">지급액</th>
              <th className="px-2 py-2">청구방식</th>
              <th className="px-2 py-2">상세내역</th>
```

`new_string`:
```tsx
              <th className="w-10 px-2 py-2">No</th>
              <th className="w-24 px-2 py-2">지급명의</th>
              <th className="w-28 px-2 py-2">고객사</th>
              <th className="px-2 py-2">사업자명(이름)</th>
              <th className="w-20 px-2 py-2">단가</th>
              <th className="w-20 px-2 py-2">교통비</th>
              <th className="w-20 px-2 py-2">재료비</th>
              <th className="w-14 px-2 py-2">횟수</th>
              <th className="w-24 px-2 py-2">지급액</th>
              <th className="w-28 px-2 py-2">청구방식</th>
              <th className="px-2 py-2">상세내역</th>
```

(표 레이아웃은 그대로 자동(`table-layout` 기본값) 유지 — 사업자명(콤보박스)/상세내역은 지금처럼 유동폭.)

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 3: 수동 검증**

Run: `npm run dev` → 등록 화면에서 횟수/단가 등 숫자 칸이 좁아지고 사업자명/상세내역 칸은 그대로 넓게 유지되는지 확인. 값을 입력해도 입력창이 잘리지 않는지 확인.

- [ ] **Step 4: 커밋**

```bash
git add "src/app/(app)/expenses/PaymentRequestRowsTable.tsx"
git commit -m "$(cat <<'EOF'
style(payment-request): 등록 행 편집기 컬럼 너비 재배치

숫자/선택 컬럼은 좁게, 사업자명/상세내역은 유동폭으로 유지해 배열을 고르게 정리.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `PaymentRequestExcelUploadModal.tsx` 신규 생성 (스텁)

**Files:**
- Create: `src/app/(app)/expenses/PaymentRequestExcelUploadModal.tsx`

**Interfaces:**
- Consumes: `FileDropzone`(`@/components/FileDropzone`, 기존).
- Produces: `PaymentRequestExcelUploadModal({ onClose }: { onClose: () => void })` — Task 5가 `PaymentRequestListPanel`에서 이 모달을 연결한다.

- [ ] **Step 1: 구현**

```tsx
// src/app/(app)/expenses/PaymentRequestExcelUploadModal.tsx
"use client";

import { FileDropzone } from "@/components/FileDropzone";

// 정산담당자/관리자가 등록된 지급요청을 엑셀로 다운로드해 지급일/지급여부만 채운 뒤
// 재업로드하는 팝업. 실제 파싱·DB 반영은 다음 단계에서 서버 액션을 연결한다 — 이번 단계는 화면만.
export function PaymentRequestExcelUploadModal({ onClose }: { onClose: () => void }) {
  function handleUpload() {
    alert("추후 구현 예정입니다.");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-[14px] bg-[var(--color-surface)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold">⬆ 엑셀 업로드</h2>
          <button type="button" onClick={onClose} className="text-[var(--color-muted)]" aria-label="닫기">✕</button>
        </div>
        <p className="mb-4 text-sm text-[var(--color-muted)]">
          다운로드한 엑셀에 지급일/지급여부만 채워서 업로드하면 해당 값만 반영됩니다.
        </p>

        <FileDropzone name="file" accept=".xlsx,.xls,.csv" hint="지원 확장자: .xlsx, .xls, .csv" />

        <p className="mt-3 rounded bg-[var(--color-hover)] px-3 py-2 text-xs text-[var(--color-muted)]">
          반영 항목: 지급일, 지급여부
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">취소</button>
          <button type="button" onClick={handleUpload} className="rounded bg-[var(--color-primary)] px-5 py-2 text-sm text-white">⬆ 업로드 실행</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음(아직 어디서도 import하지 않으므로 미사용 경고 없음).

- [ ] **Step 3: 커밋**

```bash
git add "src/app/(app)/expenses/PaymentRequestExcelUploadModal.tsx"
git commit -m "$(cat <<'EOF'
feat(payment-request): 엑셀 업로드(지급일/여부 재반영) 스텁 모달 추가

PayeeUploadModal과 같은 드롭존 형태. 실제 파싱/DB 반영은 다음 단계에서 연결.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 등록 팝업 제거 + 엑셀 업로드 연결 + 정리

**Files:**
- Modify: `src/app/(app)/expenses/PaymentRequestListPanel.tsx`
- Modify: `src/app/(app)/expenses/page.tsx`
- Delete: `src/app/(app)/expenses/PaymentRequestRegisterModal.tsx`

**Interfaces:**
- Consumes: `PaymentRequestExcelUploadModal`(Task 4).
- Produces: `PaymentRequestListPanel`의 props에서 `payees`가 제거된다 — 이 타입 변경을 인지해야 하는 다른 소비처는 없다(`page.tsx`가 유일한 호출부이며 이 태스크에서 함께 수정한다).

- [ ] **Step 1: `PaymentRequestListPanel.tsx`의 import 정리**

`old_string`:
```tsx
import { PAYMENT_REQUEST_PAGE_SIZE, type PaymentRequestRow } from "@/lib/data/payment-requests";
import type { PayeeOption } from "@/lib/data/payees";
import type { AppRole } from "@/lib/auth/rbac";
import { ClientCombobox } from "@/components/ClientCombobox";
import { PaymentRequestPager } from "./PaymentRequestPager";
import { PaymentRequestNoticeBanner } from "./PaymentRequestNoticeBanner";
import { PaymentRequestDetailModal } from "./PaymentRequestDetailModal";
import { PaymentRequestBulkUpdateModal } from "./PaymentRequestBulkUpdateModal";
import { PaymentRequestRegisterModal } from "./PaymentRequestRegisterModal";
```

`new_string`:
```tsx
import { PAYMENT_REQUEST_PAGE_SIZE, type PaymentRequestRow } from "@/lib/data/payment-requests";
import type { AppRole } from "@/lib/auth/rbac";
import { ClientCombobox } from "@/components/ClientCombobox";
import { PaymentRequestPager } from "./PaymentRequestPager";
import { PaymentRequestNoticeBanner } from "./PaymentRequestNoticeBanner";
import { PaymentRequestDetailModal } from "./PaymentRequestDetailModal";
import { PaymentRequestBulkUpdateModal } from "./PaymentRequestBulkUpdateModal";
import { PaymentRequestExcelUploadModal } from "./PaymentRequestExcelUploadModal";
```

- [ ] **Step 2: props 시그니처에서 `payees` 제거, 상태 이름 교체**

`old_string`:
```tsx
export function PaymentRequestListPanel({
  rows,
  page,
  totalPages,
  clients,
  payees,
  filterValues,
  role,
  currentUserId,
}: {
  rows: PaymentRequestRow[];
  page: number;
  totalPages: number;
  clients: { id: string; name: string; businessType: string | null }[];
  payees: PayeeOption[];
  filterValues: FilterValues;
  role: AppRole;
  currentUserId: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailTarget, setDetailTarget] = useState<PaymentRequestRow | null>(null);
  const [bulkUpdateOpen, setBulkUpdateOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
```

`new_string`:
```tsx
export function PaymentRequestListPanel({
  rows,
  page,
  totalPages,
  clients,
  filterValues,
  role,
  currentUserId,
}: {
  rows: PaymentRequestRow[];
  page: number;
  totalPages: number;
  clients: { id: string; name: string; businessType: string | null }[];
  filterValues: FilterValues;
  role: AppRole;
  currentUserId: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailTarget, setDetailTarget] = useState<PaymentRequestRow | null>(null);
  const [bulkUpdateOpen, setBulkUpdateOpen] = useState(false);
  const [excelUploadOpen, setExcelUploadOpen] = useState(false);
```

- [ ] **Step 3: "+ 등록"(SETTLEMENT/ADMIN) 버튼을 "⬆ 엑셀 업로드"로 교체**

`old_string`:
```tsx
        {role === "PM" ? (
          <Link href="/expenses/payment-request/new" className="rounded bg-[var(--color-success)] px-4 py-2 text-sm text-white">
            + 등록
          </Link>
        ) : (
          <button type="button" onClick={() => setRegisterOpen(true)} className="rounded bg-[var(--color-success)] px-4 py-2 text-sm text-white">
            + 등록
          </button>
        )}
```

`new_string`:
```tsx
        {role === "PM" && (
          <Link href="/expenses/payment-request/new" className="rounded bg-[var(--color-success)] px-4 py-2 text-sm text-white">
            + 등록
          </Link>
        )}
        {canExport && (
          <button type="button" onClick={() => setExcelUploadOpen(true)} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">
            ⬆ 엑셀 업로드
          </button>
        )}
```

- [ ] **Step 4: 모달 렌더 블록 교체**

`old_string`:
```tsx
      {registerOpen && (
        <PaymentRequestRegisterModal clients={clients} payees={payees} onClose={() => setRegisterOpen(false)} />
      )}
```

`new_string`:
```tsx
      {excelUploadOpen && (
        <PaymentRequestExcelUploadModal onClose={() => setExcelUploadOpen(false)} />
      )}
```

- [ ] **Step 5: `page.tsx`에서 payees 조회/전달 제거**

`old_string`:
```typescript
import { listPayees, listPayeesForPm, listPayeeOptions, parsePage, parsePayeeSearchField, parsePayeePmSearchField } from "@/lib/data/payees";
```

`new_string`:
```typescript
import { listPayees, listPayeesForPm, parsePage, parsePayeeSearchField, parsePayeePmSearchField } from "@/lib/data/payees";
```

`old_string`:
```tsx
  const ctx = getRlsContext(user);
  const [clients, payees] = await Promise.all([
    listClients(ctx),
    user.role === "PM" ? Promise.resolve([]) : listPayeeOptions(ctx),
  ]);
```

`new_string`:
```tsx
  const ctx = getRlsContext(user);
  const clients = await listClients(ctx);
```

`old_string`:
```tsx
      clients={clients.map((c) => ({ id: c.id, name: c.name, businessType: c.businessType }))}
      payees={payees}
      filterValues={{
```

`new_string`:
```tsx
      clients={clients.map((c) => ({ id: c.id, name: c.name, businessType: c.businessType }))}
      filterValues={{
```

- [ ] **Step 6: 미사용 `PaymentRequestRegisterModal.tsx` 삭제**

```bash
git rm "src/app/(app)/expenses/PaymentRequestRegisterModal.tsx"
```

- [ ] **Step 7: 타입체크 + 전체 테스트**

Run: `npx tsc --noEmit`
Expected: 에러 없음(특히 `payees`/`PayeeOption` 관련 미사용·미정의 에러 없는지 확인).

Run: `npx vitest run`
Expected: 전체 PASS(회귀 없음 — `payees` 관련 데이터 계층 자체는 변경하지 않았으므로 `test/data-payees.test.ts`는 영향 없음).

- [ ] **Step 8: 수동 검증**

Run: `npm run dev`
- SETTLEMENT/ADMIN 계정: 목록 화면 액션바에 "+ 등록"이 없고 "⬆ 엑셀 업로드"가 있다. 클릭 시 업로드 모달이 뜨고, 파일 선택 후 "업로드 실행" 클릭 시 안내 알림이 뜬다. "취소"/배경 클릭 시 닫힌다.
- PM 계정: "+ 등록"이 여전히 `/expenses/payment-request/new`로 정상 이동한다(영향 없음).
- PM 등록 페이지(`/expenses/payment-request/new`) 자체는 이 태스크와 무관하게 정상 동작한다(Task 1~3에서 이미 검증됨).

- [ ] **Step 9: 커밋**

```bash
git add "src/app/(app)/expenses/PaymentRequestListPanel.tsx" "src/app/(app)/expenses/page.tsx"
git commit -m "$(cat <<'EOF'
feat(payment-request): 정산담당자/관리자 등록 팝업 제거, 엑셀 업로드로 대체

SETTLEMENT/ADMIN은 신규 등록이 불필요 — "+ 등록" 버튼을 없애고
"엑셀 업로드"(지급일/여부 재반영, 스텁) 버튼으로 교체. 더 이상 쓰이지
않는 PaymentRequestRegisterModal과 그 때문에 필요했던 payees 조회를
함께 정리.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## 완료 조건

- [ ] PM 등록 화면에 "엑셀 업로드(예외건)"/"지급액(자동)" 같은 괄호 표기가 남아있지 않다.
- [ ] PM 등록 화면 헤더 체크박스로 전체 행 선택/해제가 가능하다.
- [ ] PM 등록 화면의 숫자/선택 컬럼(지급명의/고객사/단가/교통비/재료비/횟수/지급액/청구방식)이 좁게, 사업자명/상세내역은 유동폭으로 배치되어 있다.
- [ ] SETTLEMENT/ADMIN 목록 화면에 "+ 등록"이 없고 "⬆ 엑셀 업로드"가 있으며, 클릭 시 업로드 모달(스텁)이 뜬다.
- [ ] PM의 "+ 등록"(전체 페이지 이동)은 변경 없이 그대로 동작한다.
- [ ] `PaymentRequestRegisterModal.tsx`가 삭제되었고, 그로 인해 필요 없어진 `payees` 조회/전달이 `page.tsx`/`PaymentRequestListPanel.tsx`에서 제거되었다.
- [ ] `npx tsc --noEmit`, `npx vitest run` 전체 통과.
