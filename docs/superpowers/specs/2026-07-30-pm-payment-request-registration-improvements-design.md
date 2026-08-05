# PM 지급요청 등록 화면 개선 (레이아웃/자동완성/저장)

## 배경

`docs/superpowers/specs/2026-07-30-payment-request-new-form-ui-polish-design.md` 등으로 PM 등록 화면(`/expenses/payment-request/new`)의 골격은 이미 만들어져 있다. 실제로 써보며 확인한 결과:

- 지급액 자동계산은 이미 렌더마다 재계산되어 실시간 반영 중 (문제 없음, 확인만).
- 사업자명(이름) 자동완성(`PayeeCombobox`)은 "이름 (고유번호)" 표시 → 선택 시 이름만 남는 구조가 이미 있음.
- 고객사는 자동완성이 아니라 일반 `<select>`(등록된 목록만 선택 가능).
- No, 청구방식 컬럼이 화면에 노출되어 있다.
- 저장(`handleSave`)은 `alert` 스텁뿐, 실제 DB 저장 로직이 없다.
- 자동완성 드롭다운 높이가 좁아(`max-h-52`) 매칭 항목이 많으면 내부 스크롤이 생겨 가독성이 떨어진다.
- 단가/교통비/재료비 입력칸 폭이 좁아 큰 금액이 잘려 보일 수 있다.

이번 스펙은 PM 등록 화면 하나에 집중해 레이아웃, 컬럼 정리, 고객사/사업자명 자동완성 개선, 저장 기능 신규 구현까지 다룬다. 엑셀 업로드(예외 건) 실제 구현과 ADMIN/SETTLEMENT 화면은 범위 밖이다.

## 결정 사항

### 1. 지급액 자동계산 — 변경 없음

`computeRowAmount()`가 렌더마다 재계산되어 이미 단가/교통비/재료비/횟수를 하나씩 입력할 때마다 실시간으로 지급액에 반영된다. 확인 후 추가 변경이 필요 없다고 결론.

### 2. No / 청구방식 컬럼 제거, 청구방식 자동 반영

- `PaymentRequestRowsTable.tsx` 헤더·셀에서 No, 청구방식 컬럼을 제거한다.
- `DraftRow.taxType`은 화면에 노출하지 않되 내부 상태로는 계속 유지한다: 사업자(Payee)를 선택하면 그 Payee의 `taxType`을 자동으로 채운다 (청구방식 `<select>` 삭제, 선택 콜백에서 대신 채움).
- 이를 위해 `PayeeOption`(`src/lib/data/payees.ts:408`)에 `taxType` 필드를 추가한다 — 현재 `{ id, keyId, bizName }`뿐이라 `listPayeeOptions()`의 `select`에 `taxType: true`를 더한다.
- 사업자를 아직 선택하지 않은 행은 `taxType`이 빈 값으로 남고, 저장 시 "사업자 선택 필수" 검증(결정 사항 4)에 걸려 전체 저장이 차단된다.

### 3. 고객사 자동완성

- 기존 `<select>`(`PaymentRequestRowsTable.tsx:174-179`)를 `PayeeCombobox`와 같은 콜백 패턴의 새 콤보박스로 교체한다.
- 기존 `src/components/ClientCombobox.tsx`는 필터바용 hidden-input 패턴(다른 용도)이라 그대로 재사용하지 않고, `PayeeCombobox`를 본떠 별도 컴포넌트(`src/components/PaymentRequestClientCombobox.tsx`)를 새로 만든다. 레포에 이미 Payee/Client 콤보박스가 로직을 공유하지 않고 각자 존재하는 관례를 따른다.
- 등록된 고객사만 선택 가능. 목록에 없는 이름을 입력하면 `clientId`가 비워진 채로 남고, 저장 시 차단된다 (신규 고객사 자동 생성 없음).

### 4. 사업자명(이름) 자동완성

- 기존 `PayeeCombobox` 동작(드롭다운엔 "이름 (고유번호)", 선택 후 입력칸엔 이름만)은 그대로 유지한다.
- **직접 타이핑만으로는 저장 불가** — 반드시 목록에서 선택해야 `payeeId`가 채워지고 저장 검증을 통과한다. 목록에 없는 예외 건은 이 화면이 아니라 엑셀 업로드로 처리한다 (범위 밖).
- 드롭다운 최대 높이를 `max-h-52` → `max-h-96`으로 확장한다 (대부분 스크롤 없이 10~12개 항목 노출, 결과가 아주 많을 때만 내부 스크롤). 새로 만드는 고객사 콤보박스에도 동일하게 적용한다.
- 사업자를 선택한 입력칸에 마우스를 올리면 그 사업자의 청구방식을 작은 툴팁으로 보여주고, 마우스를 떼면 사라진다. `PayeeCombobox`가 이미 계산해 갖고 있는 `selected` 객체(19행)를 이용해 `onMouseEnter`/`onMouseLeave` 상태로 구현한다. 사업자 미선택 행은 툴팁이 뜨지 않는다.

### 5. 입력칸 예시(placeholder)와 정렬

- 단가/교통비/재료비/횟수 입력칸에 placeholder를 추가한다 (예: 단가 "예: 50000", 교통비/재료비 "예: 0", 횟수 "예: 1"). 상세내역은 이미 placeholder가 있어 변경하지 않는다.
- 자동완성 드롭다운(사업자명/고객사) 목록 항목 텍스트를 가운데 정렬(`text-center`)로 바꾼다 — 현재는 `text-left`.
- 지급명의 `<select>`의 옵션 텍스트도 가운데 정렬을 시도한다 (`text-align-last: center` 등). 브라우저/OS 렌더링에 따라 완전히 동일하게 보이지 않을 수 있음을 감안한다.

### 6. 단가/교통비/재료비 컬럼 폭 확장

- 입력값에 따라 폭이 자동으로 늘어나는 방식은 채택하지 않는다 — 표 편집기에서 칸 폭이 입력마다 바뀌면 같은 열의 다른 행·헤더와 정렬이 흔들리는 문제가 있어, 고정 폭 확대가 더 안정적이다.
- 단가: `w-20` → `w-28` (최대 8자리, 천만원 단위까지 잘리지 않음).
- 교통비/재료비: `w-20` → `w-24` (최대 6자리, 10만원 단위까지 잘리지 않음).
- 횟수/지급액 등 나머지 폭은 변경하지 않는다.

### 7. 저장 기능 신규 구현

**클라이언트 검증** (`PaymentRequestNewForm.tsx`의 `handleSave`, 서버 호출 전에 실행):

- 행별 필수: `entity`, `clientId`, `payeeId`(목록에서 선택된 값), `unitPrice > 0`, `count > 0`. `transportFee`/`materialFee`는 0을 허용한다.
- 한 행이라도 필수값이 없으면 **전체 저장을 차단**한다 — 서버를 호출하지 않고, 문제 있는 행/칸을 빨간 테두리로 강조하고 상단에 "OO번째 행에 입력하지 않은 항목이 있습니다" 안내를 띄운다.

**서버 액션 신규 추가** (레포 기존 관례 그대로 — `requireUser` + `getRlsContext` + `withRLS` 트랜잭션):

- `src/lib/data/payment-requests.ts`에 `createPaymentRequestsBulk(ctx, inputs)`를 추가한다 — `payees.ts`의 `createPayeesBulk`와 유사하게 `withRLS` 트랜잭션 안에서 일괄 insert한다.
- `src/app/(app)/expenses/actions.ts`에 `"use server"` 액션을 추가한다 — `requireUser()`로 PM 역할 확인 후, 서버 측에서 각 행을 재검증(zod 스키마)하고 `amount`는 클라이언트 값을 신뢰하지 않고 `(unitPrice + transportFee + materialFee) * count`로 서버가 재계산한다.
- 저장은 **all-or-nothing**: 한 트랜잭션 안에서 전체 insert하고, 하나라도 실패하면 전체 롤백한다.
- 저장 값: `requesterId`(로그인한 PM), `requestedAt: now()`, `status: "PREPARING"`, `entity`/`clientId`/`payeeId`/`bizName`(선택된 Payee 스냅샷)/`unitPrice`/`transportFee`/`materialFee`/`count`/`amount`/`taxType`(선택된 Payee 스냅샷)/`memo`.
- 성공 시 `revalidatePath`로 목록 캐시를 갱신하고 `/expenses?tab=payment-request`로 redirect한다.
- 실패 시(서버 재검증 실패 등) 에러 메시지를 반환해 화면에 표시하고, 페이지 이동은 하지 않는다.

## 영향 범위

대상 파일:

- `src/app/(app)/expenses/PaymentRequestRowsTable.tsx` — 컬럼 제거/폭 조정/placeholder/고객사 콤보박스 교체/저장 검증 하이라이트 연동.
- `src/app/(app)/expenses/PaymentRequestNewForm.tsx` — 저장 검증 로직 + 신규 서버 액션 연결.
- `src/components/PayeeCombobox.tsx` — 드롭다운 높이/정렬/호버 툴팁.
- `src/components/PaymentRequestClientCombobox.tsx` (신규).
- `src/lib/data/payees.ts` — `PayeeOption`에 `taxType` 추가.
- `src/lib/data/payment-requests.ts` — `createPaymentRequestsBulk` 추가.
- `src/app/(app)/expenses/actions.ts` — 저장 서버 액션 추가.
- Prisma 스키마/마이그레이션 변경 없음 (기존 `PaymentRequest`/`Payee` 모델 그대로 사용).

`PaymentRequestRowsTable`은 현재 PM 등록 화면에서만 쓰인다 — ADMIN/SETTLEMENT용 등록 팝업은 이미 제거되어(`5d04089`) 공용 컴포넌트 영향은 없다.

범위 밖: 엑셀 업로드(예외 건) 실제 파싱/저장 로직, ADMIN/SETTLEMENT 화면.

## 테스트 계획

- 자동 테스트 대상 아님 (레포 관례상 React 컴포넌트 자동 테스트 없음, `vitest.config.ts`는 `environment: "node"`) — 단, 신규 데이터 함수 `createPaymentRequestsBulk`의 순수 검증/금액 재계산 로직은 유닛 테스트 대상으로 고려할 수 있다.
- `npx tsc --noEmit` 통과.
- 수동 검증(`npm run dev`, PM 계정으로 로그인):
  - No/청구방식 컬럼이 화면에서 사라짐.
  - 사업자명 선택 시 청구방식이 자동으로 내부 반영됨 (화면엔 안 보이지만 저장 결과로 확인).
  - 사업자명 입력칸에 마우스를 올리면 청구방식 툴팁이 뜨고, 치우면 사라짐.
  - 고객사를 이름으로 검색해 자동완성으로 선택 가능하고, 목록에 없는 이름을 입력하면 선택되지 않고 저장이 차단됨.
  - "더미" 검색 시 드롭다운이 스크롤 없이 여러 항목을 보여줌 (높이 확장 확인).
  - 단가/교통비/재료비 입력칸에 예시 placeholder가 보이고, 각각 천만원/10만원 단위까지 입력해도 잘리지 않음.
  - 필수값 하나를 빠뜨리고 저장을 시도하면 전체 저장이 차단되고 해당 행/칸이 빨간 테두리로 표시됨.
  - 모든 행을 정상 입력 후 저장하면 지급요청 목록 화면으로 이동하고, DB에 정확한 값(특히 서버에서 재계산된 `amount`, 스냅샷된 `bizName`/`taxType`)으로 저장됨을 확인.
