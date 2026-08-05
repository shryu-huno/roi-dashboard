# 지급요청 등록 화면(PM) UI 다듬기

## 배경

`docs/superpowers/specs/2026-07-30-payment-request-ui-design.md`(뼈대 설계)와 그 구현 계획으로 PM 등록 전체 페이지(`/expenses/payment-request/new`)가 이미 만들어져 있다. 실제 화면을 사용해보니 라벨 표기, 전체선택 동작, 컬럼 너비 세 가지가 개선이 필요해 이번 스펙에서 다듬는다. 데이터 모델이나 저장 로직에는 영향이 없는 순수 UI 변경이다.

## 결정 사항

### 1. 라벨 정리
- `PaymentRequestNewForm.tsx`의 "엑셀 업로드(예외건)" 버튼 라벨 → "엑셀 업로드".
- 같은 파일의 안내 문구("...지급 리스트에 없는 예외 건은 `엑셀 업로드(예외건)`로 등록합니다")도 "엑셀 업로드"로 맞춘다. 같은 버튼을 가리키는 두 표현이 다르면 혼동을 준다.
- `PaymentRequestRowsTable.tsx`의 "지급액(자동)" 헤더 → "지급액".

### 2. 전체선택 체크박스
- `PaymentRequestRowsTable.tsx`의 "선택" 헤더(현재 텍스트만 표시)를 체크박스로 교체해 전체 행 선택/해제를 지원한다.
- `PaymentRequestListPanel.tsx`에 이미 있는 `allSelected`/`toggleSelectAll` 패턴을 그대로 `PaymentRequestRowsTable`이 내부적으로 소유한 `selected` 상태에 적용한다(행 삭제 대상 선택과 동일한 상태를 재사용, 새 상태 추가 없음).

### 3. 컬럼 너비 재배치
- 표 레이아웃은 지금처럼 자동(`table-layout` 기본값) 유지 — `table-fixed`로 바꾸지 않는다. 좁아야 할 컬럼에만 명시적 최대 너비를 준다.
- 너비 지정(Tailwind 유틸리티 클래스, `<th>`에 적용):
  - 지급명의 `w-24`, 고객사 `w-28`
  - 단가/교통비/재료비 각 `w-20`, 횟수 `w-14`(가장 좁음), 지급액 `w-24`
  - 청구방식 `w-28`
  - 선택/No는 기존 `w-10` 유지
- 사업자명(이름, `PayeeCombobox`)과 상세내역(비고)은 지금처럼 유동폭 유지(`min-w-[10rem]`) — 내용 길이가 가변적이므로 좁히지 않는다.

## 영향 범위

- 대상 파일: `src/app/(app)/expenses/PaymentRequestNewForm.tsx`, `src/app/(app)/expenses/PaymentRequestRowsTable.tsx`.
- 데이터 모델/서버 액션/RLS 변경 없음. `PaymentRequestRowsTable`은 등록 팝업(`PaymentRequestRegisterModal`)과 공용이므로 이번 변경(라벨 제외)은 그 팝업에도 함께 반영된다 — 별도 스펙 불필요, 같은 컴포넌트를 고치는 것이므로 자연히 동기화된다.
- 범위 밖: 등록 저장(서버 액션), 그 외 4가지 남은 기능(수정/삭제/엑셀/공지사항)은 이 스펙에서 다루지 않는다.

## 테스트 계획

- 자동 테스트 대상 아님 — 레포 관례상 React 컴포넌트에 대한 자동 테스트가 없다(`vitest.config.ts`가 `environment: "node"`).
- `npx tsc --noEmit` 통과.
- 수동 검증(`npm run dev`):
  - PM "+ 등록" 페이지에서 라벨이 "엑셀 업로드"/"지급액"으로 표시됨.
  - 헤더 체크박스 클릭 시 전체 행이 선택/해제되고, "- 행 삭제"로 한 번에 삭제됨.
  - 개별 행 체크와 헤더 체크박스가 서로 정합적으로 갱신됨(일부만 선택 시 헤더는 미선택 상태).
  - 컬럼 너비가 조정되어 횟수/단가 등 숫자 칸이 좁아지고, 사업자명/상세내역 칸은 그대로 넓게 유지됨.
  - ADMIN/SETTLEMENT 등록 팝업(`PaymentRequestRegisterModal`)에서도 동일한 표가 반영되어 있음(공용 컴포넌트이므로).
