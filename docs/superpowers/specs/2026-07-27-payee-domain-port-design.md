# Payee(지급 대상자) 도메인 포팅 — 설계

작성일: 2026-07-27

## 배경

지급 대상자(강사/업체) 원장과 엑셀 업로드 기능이 별도 저장소(`lsj-huno/payees`)에서
개발됐다. 그 저장소는 이 앱(`shryu-huno/roi-dashboard`)의 과거 스냅샷을 히스토리 없이
복사해 시작된 것으로, git 히스토리 상 공통 조상이 없다(`git merge-base`가 빈 값을 반환).
이 기능을 원래 있어야 할 `roi-dashboard`로 포팅한다.

## 요구사항

- Payee(지급 대상자) 원장: 강사(주민등록번호)/업체(사업자등록번호) 공용 원장, 민감정보는
  앱 계층에서 AES-256-GCM 암호화 + 마스킹 표시 + HMAC 블라인드 인덱스(정확일치 검색).
- 엑셀(xlsx) 업로드로 대량 등록. 서식 다운로드 제공.
- 지급 리스트 원문(복호화된 사업자번호/계좌번호) 조회는 **ADMIN/SETTLEMENT 전용**. PM은
  접근 불가 — 기존 role 모델(`ADMIN` > `SETTLEMENT` > `PM`)과 동일 기준.
- `/expenses` 페이지에 진입점 추가(현재 탭 구조가 없어 신규 도입 필요).
- 환경변수(`PAYEE_ENC_KEY`, `PAYEE_BIDX_KEY`) 실제 값 발급·배포환경 등록은 이번 범위 밖.
  `.env.example`에 항목만 추가.

## 설계

### 1. 스키마 + 마이그레이션 (`prisma/schema.prisma`)

기존 모델 변경 없이 순수 추가:

- enum `PayeeType`(INSTRUCTOR/VENDOR), `TaxType`(6종: 세금계산서/면세계산서/현금영수증/
  수기계산서/사업소득/기타소득), `PayeeFileType`(BIZ_CERT/BANKBOOK)
- model `Payee` — `keyId`(a001/b001, 전용 Postgres 시퀀스 2개로 원자적 채번),
  `bizNumberEnc`/`bizNumberMasked`/`bizNumberBidx`, `accountNumberEnc`/`accountNumberMasked`,
  `phone`/`phoneNormalized`, `bankName`, `accountHolder`, `taxType`
- model `PayeeAttachment` — 첨부 스키마만 정의(업로드 플로우는 범위 밖, payees 저장소도
  동일하게 미구현 상태였음)
- 신규 마이그레이션 1개, roi-dashboard의 실제 마이그레이션 이력 위에 `prisma migrate dev`로
  생성 검증(payees 저장소의 SQL을 참고하되 그대로 복사하지 않음 — 베이스 히스토리가 다름).
- RLS: `Payee`/`PayeeAttachment` 모두 `ENABLE`+`FORCE ROW LEVEL SECURITY`. SELECT는 전
  역할 허용(`USING (true)`), INSERT/UPDATE/DELETE는
  `current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')`만 허용 — 기존 RLS
  마이그레이션(`20260708080806_rls` 등)과 동일한 GUC 패턴.

### 2. 데이터/로직 계층 — payees 저장소에서 그대로 이식(대응 파일 없음, 충돌 없음)

- `src/lib/crypto/payee-secret.ts` — AES-GCM 암복호화, HMAC 블라인드 인덱스, 마스킹,
  사업자번호 자릿수(10/13)로 업체/강사 판별.
- `src/lib/data/payees.ts` — `createPayeesBulk`(유형별 시퀀스 채번 + bulk insert,
  `withRLS` 사용), `listPayees`(role 체크 후 복호화 반환), `findPayeeByBizNumber`(블라인드
  인덱스 검색, 업로드 시 중복 스킵에 사용).
- `src/app/(app)/expenses/payees/xlsx.ts` — exceljs 기반 파싱(`parseXlsxToRows`)/서식
  생성(`buildTemplateXlsxBuffer`, 숫자 손상 방지용 텍스트 서식).
- `src/app/(app)/expenses/payees/build-inputs.ts` — 엑셀 행 → `PayeeCreateInput` 변환,
  행 단위 검증 오류 수집, bidx 기준 중복 스킵.
- `src/app/(app)/expenses/payees/actions.ts` — 업로드 서버액션. 표준 패턴 준수:
  `requireRole(["ADMIN","SETTLEMENT"])` → `getRlsContext` → `zod safeParse` →
  data-layer → `revalidatePath("/expenses")` → `ActionState`.
- `src/app/(app)/expenses/payees/{template/route.ts, upload-state.ts}`.
- `src/lib/labels.ts`(신규) — `TAX_TYPE_LABELS`.
- import 경로만 재확인, 로직은 변경하지 않는다(이미 payees 저장소에서 테스트됨).

### 3. UI 통합 (`src/app/(app)/expenses/page.tsx` 등)

- 현재 단일 화면인 `/expenses`를 "전체내역 / 지급리스트" 2탭으로 재구성. payees 저장소의
  `ExpenseTabs`/`tabs.ts`를 참고하되 이번 범위(2탭)만 손 구현 — 준비중 placeholder 탭 등
  범위 밖 기능은 가져오지 않는다.
- 지급리스트 탭: `visibleExpenseTabs`류 헬퍼로 ADMIN/SETTLEMENT가 아니면 탭 자체를
  노출하지 않음. 직접 URL 접근 시에도 서버에서 role 재검증(리다이렉트).
- `PayeeListPanel.tsx`(목록, 마스킹/원문 표시, 첨부 배지), `PayeeUploadModal.tsx`(업로드
  모달), `src/components/FileDropzone.tsx`(재사용 드래그앤드롭, 기존 `Add-A` 커밋에서
  이미 라벨 prop화됨 — 그대로 이식) — payees 저장소에서 이식.

### 4. 검증 스키마 & 환경변수

- `src/lib/validation/schemas.ts`: `payeeUploadRowSchema` 등 추가(zod). 기존 파일이라
  손으로 병합(자동 patch 대상 아님).
- `.env.example`: `PAYEE_ENC_KEY`(AES 키, base64 32바이트), `PAYEE_BIDX_KEY`(HMAC 키,
  base64 32바이트 이상) 안내 주석 + 빈 값 추가. 실제 키 발급/등록은 범위 밖.
- `package.json`: `exceljs` 의존성 추가.

### 5. 테스트

payees 저장소에서 이식(로직 변경 없음, import 경로만 조정):

- `test/payee-secret.test.ts` — 암복호화/마스킹/블라인드 인덱스 라운드트립.
- `test/data-payees.test.ts` — 채번, bulk insert, 복호화 목록.
- `test/payee-rls.test.ts` — PM/기타 role의 쓰기 시도 차단, SELECT는 전 role 허용 확인.
- `test/payee-build-inputs.test.ts` — 엑셀 행 검증/판별/중복 스킵.
- `test/payee-xlsx.test.ts` — xlsx 파싱/서식 생성.
- `test/schemas.test.ts` 증분분 — `payeeUploadRowSchema` 케이스.

roi-dashboard는 실제 Postgres가 필요한 테스트 구성(`test/global-setup.ts`가 마이그레이션
자동 적용)이므로, 마이그레이션 생성 후 로컬 `npm test`로 전체 통과를 확인한다.

## 범위 제외

- `PayeeAttachment`의 실제 파일 업로드 플로우(스키마만 존재, payees 저장소도 미구현).
- `PAYEE_ENC_KEY`/`PAYEE_BIDX_KEY` 운영 환경 발급·등록.
- payees 저장소의 "지급요청/법인카드/개인카드" 준비중 placeholder 탭.
