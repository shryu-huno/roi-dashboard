# 정산담당자/관리자 등록 제거 → 엑셀 업로드(지급일/여부 재반영) 대체

## 배경

`2026-07-30-payment-request-ui-design.md`(뼈대 설계)는 SETTLEMENT/ADMIN도 PM처럼 신규 지급요청을 팝업(`PaymentRequestRegisterModal`)으로 등록할 수 있다고 가정했다. 실제로는 정산담당자/관리자가 신규 건을 직접 등록할 필요가 없다 — 이들의 실제 업무는 PM이 이미 등록한 건들을 엑셀로 다운로드해 지급일/지급여부만 채운 뒤 재업로드하는 것이다. 이는 원 설계 문서의 "정산담당자 업데이트" 3가지 진입점 중 "엑셀 다운로드 → 수정 → 재업로드"에 해당한다.

## 결정 사항

### 등록 팝업 제거
- `PaymentRequestListPanel.tsx` 액션바에서 SETTLEMENT/ADMIN 전용 "+ 등록" 버튼을 제거한다. PM의 "+ 등록"(`/expenses/payment-request/new` 전체 페이지 Link)은 변경 없이 유지한다.
- `PaymentRequestRegisterModal.tsx`는 이 변경으로 더 이상 어디서도 쓰이지 않으므로 파일을 삭제한다(행 편집기 `PaymentRequestRowsTable`는 PM 등록 페이지에서 계속 쓰이므로 영향 없음).

### 엑셀 업로드 버튼 신설
- 제거된 "+ 등록" 자리에 SETTLEMENT/ADMIN 전용 "⬆ 엑셀 업로드" 버튼을 추가한다. 클릭 시 새 모달 `PaymentRequestExcelUploadModal.tsx`를 연다.
- 이 모달은 `PayeeUploadModal.tsx`와 같은 형태(파일 드롭존 + 안내 문구 + "업로드 실행" 버튼)로 만들되:
  - 안내 문구는 지급일/지급여부만 반영됨을 설명한다.
  - 이미 액션바에 별도 "📗 엑셀 다운로드" 버튼이 있으므로, 모달 안에 서식/다운로드 링크는 중복으로 넣지 않는다.
- **이번 단계는 스텁이다**: "업로드 실행" 클릭 시 실제 엑셀 파싱이나 DB 반영 서버 액션 없이 `alert("추후 구현 예정입니다.")`만 띄운다. 실제 파싱/반영 로직은 다음 단계 스펙에서 구현한다(프로젝트 전체가 따르는 "화면 먼저, 쓰기 로직은 이후" 패턴과 동일).

## 영향 범위

- 수정: `src/app/(app)/expenses/PaymentRequestListPanel.tsx`(액션바 버튼 교체, import 정리).
- 삭제: `src/app/(app)/expenses/PaymentRequestRegisterModal.tsx`(사용처 없어짐에 따른 정리).
- 신규: `src/app/(app)/expenses/PaymentRequestExcelUploadModal.tsx`.
- 데이터 모델/RLS/서버 액션 변경 없음.
- PM 등록 전체 페이지(`/expenses/payment-request/new`)와 그 안의 `PaymentRequestRowsTable` 공용 컴포넌트는 이번 변경과 무관하게 그대로 유지된다.
- 범위 밖: 엑셀 실제 파싱/DB 반영 로직, 엑셀 다운로드 실제 생성 로직 — 둘 다 다음 단계 스펙에서 진행.

## 완료 조건 갱신 (원 설계 문서 대비)

- 원 뼈대 설계 문서의 "정산담당자/관리자 같은 전체 페이지 대신 팝업 모달로 등록" 조항은 이 스펙으로 대체된다: SETTLEMENT/ADMIN은 등록 대신 엑셀 업로드(재반영)만 가능하다.

## 테스트 계획

- 자동 테스트 대상 아님(레포 관례상 React 컴포넌트 자동 테스트 없음).
- `npx tsc --noEmit` 통과(삭제된 `PaymentRequestRegisterModal` import 잔여 없음 확인 포함).
- 수동 검증(`npm run dev`):
  - SETTLEMENT/ADMIN 계정: 목록 화면 액션바에 "+ 등록"이 없고 "⬆ 엑셀 업로드"가 있다. 클릭 시 업로드 모달이 뜨고, 파일 선택 후 "업로드 실행" 클릭 시 안내 알림이 뜬다.
  - PM 계정: "+ 등록"이 여전히 `/expenses/payment-request/new`로 정상 이동한다(영향 없음 확인).
