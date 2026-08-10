# 지급요청 탭 UI 설계

## 배경

PM이 강사/업체에게 지급할 비용을 요청하면, 정산담당자가 지급일/지급여부를 확인·처리하는 "지급요청" 탭을 신설한다. `/expenses` 탭 목록에는 이미 `payment-request`("지급 요청") 키가 정의돼 있지만 화면은 아직 없다(`PlaceholderTab`으로 표시됨). 세부 기능(등록/수정/삭제/엑셀다운로드/공지사항)은 이번 스펙 이후 하나씩 별도 스펙으로 구현하고, 이번 스펙에서는 데이터 모델과 화면 전체 형태(뼈대)를 확정한다.

## 현재 상태 (조사 결과)

- `src/app/(app)/expenses/tabs.ts`에 `payment-request` 탭이 `roles: ["ADMIN", "SETTLEMENT"], pmScoped: true`로 이미 선언돼 있음 — PM은 `pmScoped` 규칙으로 접근 가능. `page.tsx`의 분기 스위치에만 아직 연결 안 됨.
- "지급 리스트"(`Payee` 모델 + `PayeeListPanel`/`PayeePmListPanel`)는 강사/업체 **마스터 정보**(사업자번호, 계좌, 청구방식 등)만 다루고, 신청일/신청인/지급명의/고객사/지급액/지급일/지급여부 같은 "건별 지급요청" 데이터는 없음 — 신규 모델 필요.
- 재사용 가능한 기존 패턴:
  - `PayeeListPanel.tsx`/`PayeePmListPanel.tsx` — role별 분기, 체크박스+테이블+상단 액션바 레이아웃.
  - `PayeePager.tsx` — 페이지네이션(고정 `PAGE_SIZE`, URL 쿼리 기반).
  - `PayeeUploadModal.tsx`, `PayeeDeleteConfirmModal.tsx`, `PayeeAttachmentModal.tsx` — 등록/삭제확인/개별 팝업 UI 패턴.
  - `AllExpensesTab`/`ConsultingTab`(`page.tsx`) — 고객사(`ClientCombobox`) + 기간(from/to) 다중 필터 폼 패턴(지급요청 필터바가 이 패턴에 더 가까움).
  - `TaxType` enum(`prisma/schema.prisma`) — 세금계산서/면세계산서/현금영수증/수기계산서/사업소득. "청구방식" 드롭다운에 그대로 재사용.
  - `requireRole`/`hasAtLeast`(`src/lib/auth/session.ts`, `src/lib/auth/rbac.ts`) — 서버 액션 권한 가드 패턴(ADMIN > SETTLEMENT > PM).
- `Client` 모델에 이미 `businessType String? // 사업자 구분: 휴노 | 휴노INC` 필드가 있음. 지급명의(휴노/휴노INC)와 개념이 겹치지만, PM이 건별로 수동 선택하겠다고 명시했으므로 별도 필드로 둔다(고객사 선택 시 `businessType` 값이 있으면 기본값으로 채워주되 PM이 덮어쓸 수 있게 하는 정도로만 연결— 강제 동기화는 하지 않음).
- 공지사항 기능은 코드베이스 전체에 선례가 없음 — 완전 신규.

## 결정 사항

### 데이터 모델
- 신규 모델 `PaymentRequest` 도입(아래 스키마 참고). `Payee`와는 `payeeId`로 느슨하게 연결(nullable) — 지급 리스트에서 선택한 건은 연동, 지급 리스트에 없어 PM이 엑셀로 예외 등록한 건은 `payeeId`를 비우고 `bizName`만 텍스트로 저장.
- `amount`는 `unitPrice + transportFee + materialFee) * count`로 서버에서 재계산해 저장(클라이언트 계산값은 화면 표시용일 뿐, 신뢰하지 않음).
- `clientId`는 항상 기존 `Client`를 참조(FK 필수) — 자유 텍스트 입력 없음.
- `payDate`는 등록 시점엔 비워둔다. PM은 입력하지 않고, 정산담당자/관리자가 이후 단계에서 채운다.
- `status`는 `PREPARING`(지급준비, 기본값) / `COMPLETED`(지급완료) 2단계.

### 목록 화면
- 컬럼(고정 11개, 확장 없음): 체크박스, No, 신청일, 신청인, 지급명의, 고객사, 사업자명(이름), 지급액, 지급일, 지급여부, 관리. `단가/교통비/재료비/횟수/청구방식/상세내역(비고)`는 목록에 노출하지 않고 "상세보기" 모달에서만 표시(엑셀 다운로드에는 전체 필드 포함 예정 — 다음 단계).
- 필터바는 5개 조건 동시 적용(AND): 지급일 기간(`type="date"` 일 단위), 고객사(`ClientCombobox` 재사용), 지급명의(드롭다운), 지급여부(드롭다운), 사업자명(이름, 텍스트). 값을 비우면 전체 조회.
- 필터/조회는 **이번 단계에서 실동작**(실제 DB 쿼리). `PayeeListPanel`과 달리 단일 field+q가 아니라 다중 조건 쿼리 파라미터를 사용.
- 페이지네이션은 `PayeePager` 패턴을 그대로 재사용(별도 `PaymentRequestPager` 불필요 — props가 role/tab 값만 다르면 기존 컴포넌트를 일반화해 공용으로 쓸지, 복제할지는 구현 단계에서 결정).
- 공지사항(정산담당자/관리자만 작성)은 목록 상단 배너로 노출. 이번 단계는 레이아웃만(빈 상태 "등록된 공지가 없습니다"), 작성/수정/삭제는 다음 단계.
- 액션바: 엑셀다운로드(SETTLEMENT/ADMIN만, PM 화면엔 없음 — 기존 지급 리스트와 동일한 비대칭), 일괄수정(체크박스 선택 시 활성 — 지급일/지급여부를 여러 건에 동일 값으로 한 번에 적용), 삭제(선택 건 소프트 삭제), 등록.
- 이번 단계에서 아직 로직이 없는 버튼(엑셀다운로드/일괄수정/삭제/등록 저장/공지작성)은 클릭 시 "추후 구현 예정입니다" 안내만 표시(기존 `PlaceholderTab`의 "준비 중" 톤과 통일).

### 등록 화면
- **PM**: 전체 페이지(`/expenses/payment-request/new`). 여러 행을 한 번에 입력하는 표 형태. 기능: `+행추가`, `-행삭제`, `엑셀 업로드`(지급 리스트에 없는 예외 건용, 같은 컬럼 템플릿), `취소`, `저장`.
  - 입력 항목: 체크박스, No, 지급명의(휴노/휴노INC 드롭다운 — 고객사 선택 시 `Client.businessType` 있으면 기본값으로 채움), 고객사(담당 고객사 드롭다운), 사업자명(이름) — 검색 시 "이름+고유번호"로 후보 노출(동명이인 구분), 선택 후 셀엔 이름만 표시, 단가/교통비/재료비/횟수(지급액은 자동계산, 읽기전용), 청구방식(`TaxType` 드롭다운), 상세내역(비고, 자유 텍스트).
  - 신청일/신청인은 저장 시 서버가 로그인 계정 기준으로 자동 채움(입력 항목 아님).
  - 화면 동작(행 추가/삭제, 자동계산, 콤보박스 검색)은 이번 단계에서 완성. "저장" 클릭은 서버에 실제로 쓰지 않고 안내만(다음 단계에서 서버 액션 연결).
- **정산담당자/관리자**: 같은 전체 페이지 대신 팝업 모달(PM 폼의 행 추가 UI를 축소한 버전, 엑셀 업로드 예외 경로는 PM 전용이라 팝업엔 없음). 레이아웃만 이번 단계에서 배치.

### 상세보기 / 정산담당자 업데이트
- "관리" 열에서 여는 **단일 모달**로 통합:
  - PM: 지급완료 전이면 지급명의/고객사/사업자명/단가/교통비/재료비/횟수/청구방식/상세내역 수정 가능. 지급완료 후엔 전체 읽기전용(수정/삭제 버튼 비활성).
  - 정산담당자/관리자: 지급일/지급여부만 수정 가능(다른 필드는 읽기전용) — 첨부파일 모달과 같은 "행 하나 빠르게 처리" UX.
- 정산담당자의 지급일/지급여부 업데이트는 3가지 진입점을 병행 제공(서로 대체가 아니라 상황별 보완):
  1. 행별 상세보기 모달 — 1건 즉시 수정.
  2. 체크박스 다중선택 + 일괄수정 팝업 — 여러 건에 **동일** 지급일/지급여부 한 번에 적용.
  3. 엑셀 다운로드 → 수정 → 재업로드 — 대량 + 건별로 **다른** 값.
  - 이번 단계는 진입점(버튼/아이콘)만 배치, 실제 로직은 각각 다음 단계 스펙에서.

### 권한
- 지급완료(`COMPLETED`) 이후에는 PM이 자신이 등록한 건이라도 수정/삭제 불가 — 정산담당자/관리자만 가능.
- 탭 자체 접근 권한은 기존 `tabs.ts`의 `payment-request` 선언(ADMIN/SETTLEMENT + PM `pmScoped`)을 그대로 사용, 변경 없음.

## 데이터 모델 (Prisma)

```prisma
enum PaymentRequestEntity {
  HUNO       // 휴노
  HUNO_INC   // 휴노INC
}

enum PaymentRequestStatus {
  PREPARING  // 지급준비 (기본값)
  COMPLETED  // 지급완료
}

model PaymentRequest {
  id            String                @id @default(cuid())
  requestedAt   DateTime              @default(now())   // 신청일 (자동)
  requesterId   String                                   // 신청인
  requester     User                  @relation(fields: [requesterId], references: [id])
  entity        PaymentRequestEntity                     // 지급명의
  clientId      String                                   // 고객사
  client        Client                @relation(fields: [clientId], references: [id])
  payeeId       String?                                  // 지급 리스트 연동(있으면 FK)
  payee         Payee?                @relation(fields: [payeeId], references: [id])
  bizName       String                                   // 사업자명(이름) 스냅샷 — 연동/엑셀 예외 모두 이 값으로 표시
  unitPrice     Int                                       // 단가
  transportFee  Int                                       // 교통비
  materialFee   Int                                       // 재료비
  count         Int                                       // 횟수
  amount        Int                                       // 지급액 = (단가+교통비+재료비)×횟수, 서버 재계산
  taxType       TaxType                                   // 청구방식 (Payee.taxType과 동일 enum)
  memo          String                                    // 상세내역(비고)
  payDate       DateTime?                                 // 지급일 — 정산담당자가 이후 채움
  status        PaymentRequestStatus  @default(PREPARING) // 지급여부
  createdAt     DateTime              @default(now())
  updatedAt     DateTime              @updatedAt
  deletedAt     DateTime?                                 // 소프트 삭제

  @@index([clientId])
  @@index([requesterId])
  @@index([status])
  @@index([payeeId])
}
```

`Client`, `User`, `Payee` 모델에 역방향 관계 필드 추가 필요(`paymentRequests PaymentRequest[]`).

## 화면 설계

### 목록 화면

```
┌──────────────────────────────────────────────────────────────────┐
│ 📢 공지  (등록된 공지가 없습니다 / 정산담당자·관리자만 작성)          │
├──────────────────────────────────────────────────────────────────┤
│ 지급일: [____-__-__] ~ [____-__-__]   고객사: [전체 ▾]                │
│ 지급명의: [전체 ▾]   지급여부: [전체 ▾]   사업자명(이름): [_______]    │
│                                                          [🔍 조회]  │
├──────────────────────────────────────────────────────────────────┤
│                          [📗엑셀다운로드] [🗓️일괄수정] [🗑️삭제] [+ 등록] │
├──┬────┬──────────┬────────┬────────┬────────┬──────────┬────────┬────────┬────────┬──────┤
│☐ │ No │  신청일   │  신청인 │ 지급명의│  고객사 │사업자명(이름)│ 지급액  │ 지급일  │지급여부│ 관리 │
├──┴────┴──────────┴────────┴────────┴────────┴──────────┴────────┴────────┴────────┴──────┤
│                        « 1 2 3 4 5 »                                                        │
└──────────────────────────────────────────────────────────────────┘
```

### 등록 화면 (PM 전체 페이지)

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ 지급요청 등록                                              [엑셀 업로드] [취소] [저장]     │
├──┬───┬─────────┬────────┬──────────────┬────────┬────────┬────────┬─────┬──────────┬────────────┬────┤
│☐ │No │ 지급명의 │ 고객사  │사업자명(이름) │  단가   │ 교통비 │ 재료비 │횟수│지급액(자동)│  청구방식   │상세내역│
├──┼───┼─────────┼────────┼──────────────┼────────┼────────┼────────┼─────┼──────────┼────────────┼────┤
│☐ │ 1 │[휴노 ▾] │[A사 ▾] │[홍길동    ▾] │[100000]│[10000] │[5000]  │ [3] │  345,000  │[세금계산서▾]│[7/30 테라리움...] │
├──┴───┴─────────┴────────┴──────────────┴────────┴────────┴────────┴─────┴──────────┴────────────┴────┤
│ [+ 행 추가]  [- 행 삭제]                                                                                │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

### 상세보기 모달

역할별로 편집 가능한 필드만 다르게 열리는 단일 모달. 표시 필드: 신청일/신청인/지급명의/고객사/사업자명/단가/교통비/재료비/횟수/지급액/청구방식/상세내역/지급일/지급여부.

## 변경 파일 (예상)

- `prisma/schema.prisma` — `PaymentRequest` 모델, `PaymentRequestEntity`/`PaymentRequestStatus` enum, 관계 필드 추가 + 마이그레이션.
- `src/lib/data/payment-requests.ts` (신규) — 목록 조회(필터/페이지네이션), `PAGE_SIZE`, 검색 파라미터 파싱. `src/lib/data/payees.ts` 패턴 참고.
- `src/app/(app)/expenses/page.tsx` — `payment-request` 분기 추가(`PaymentRequestTab` 컴포넌트), `PlaceholderTab` 대체.
- `src/app/(app)/expenses/PaymentRequestListPanel.tsx`, `PaymentRequestPmListPanel.tsx` (신규) — 목록 패널(role 분기).
- `src/app/(app)/expenses/PaymentRequestDetailModal.tsx` (신규) — 상세보기/역할별 수정 모달.
- `src/app/(app)/expenses/PaymentRequestBulkUpdateModal.tsx` (신규) — 일괄수정 팝업(레이아웃만).
- `src/app/(app)/expenses/PaymentRequestNoticeBanner.tsx` (신규) — 공지사항 배너(빈 상태만).
- `src/app/(app)/expenses/payment-request/new/page.tsx` (신규) — PM 등록 전체 페이지.
- `src/app/(app)/expenses/PaymentRequestRegisterModal.tsx` (신규) — 정산담당자/관리자 등록 팝업.

## 범위 밖 (이번 단계에서 다루지 않음, 다음 단계 스펙에서 진행)

- 등록 저장(PM 페이지/정산 팝업 모두) 서버 액션.
- 수정 서버 액션(PM의 지급완료 전 필드 수정, 정산담당자의 지급일/지급여부 업데이트 — 행별/일괄/엑셀 3가지 경로 전부).
- 삭제 서버 액션(소프트 삭제).
- 엑셀 다운로드/업로드 실제 파싱·생성 로직.
- 공지사항 CRUD(모델, 서버 액션, 작성/수정/삭제 UI 동작).
- `Client.businessType`과 지급명의 자동 동기화(기본값 채우기 이상의 강제 동기화는 하지 않음).

## 테스트 계획

- `prisma migrate` 스키마 검증 — 마이그레이션 적용/롤백 정상 동작.
- `test/data-payment-requests.test.ts`(신규) — 목록 조회 함수의 5개 필터(지급일 기간/고객사/지급명의/지급여부/사업자명) 단독·조합 동작, 페이지네이션 경계값, PM/ADMIN·SETTLEMENT 결과 범위(RLS) 차이.
- 수동 검증: `/expenses?tab=payment-request` 진입 시 빈 목록 정상 렌더(공지 배너 빈 상태 포함), 필터 조합 조회 동작, PM/ADMIN 화면 차이(엑셀다운로드 버튼 유무), 등록 페이지 행 추가/삭제/자동계산 동작, "저장" 클릭 시 안내 문구 노출, 미구현 버튼들의 "추후 구현 예정" 안내 노출.
