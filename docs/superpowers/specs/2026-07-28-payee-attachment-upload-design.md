# 지급 리스트 첨부파일 업로드 기능 설계

## 배경

`/expenses` 페이지 "지급 리스트" 탭(`PayeeListPanel.tsx`)의 "첨부파일" 컬럼(`AttachmentCell`)은 이미 존재하지만 `onClick` 핸들러가 없어 클릭해도 아무 동작을 하지 않는다. `PayeeAttachment` 모델도 스키마에 이미 정의돼 있으나(`fileType`: BIZ_CERT/BANKBOOK), `docs/superpowers/specs/2026-07-27-payee-domain-port-design.md`에서 명시적으로 "실제 파일 업로드 플로우는 범위 제외"로 미뤄둔 상태였다. 이 문서는 그 업로드 플로우(팝업 UI + 저장/삭제/다운로드)의 설계를 정리한다.

## 현재 상태 (조사 결과)

- `PayeeRow`(`src/lib/data/payees.ts`)는 `hasBizCert`/`hasBankbook` boolean만 제공하고 실제 `fileUrl`/`fileName`/`attachment id`는 포함하지 않는다. 목록 화면에는 배지 표시만 필요했기 때문.
- `PayeeAttachment`는 `payeeId`+`fileType` 조합에 유니크 제약이 없어, 이론상 같은 유형 파일이 여러 개 생길 수 있는 구조다.
- 재사용 가능한 드래그앤드롭 컴포넌트 `src/components/FileDropzone.tsx`가 이미 존재한다. hidden `<input type="file">`을 감싸 네이티브 `<form action={serverAction}>` 제출과 호환되는 구조다(현재 유일한 사용처는 `PayeeUploadModal.tsx`의 엑셀 업로드).
- 프로젝트 전체에 Supabase JS SDK/Storage 연동이 전혀 없다(`@supabase/supabase-js` 의존성 없음). DB는 Prisma로 Supabase Postgres에 직접 연결돼 있을 뿐이다.
- 모달 UI는 라이브러리 없이 커스텀 오버레이 패턴을 사용한다(`PayeeUploadModal.tsx` 참고: `fixed inset-0` + `useActionState` + 서버 액션).
- 서버 액션은 `requireRole("SETTLEMENT")` → `getRlsContext(user)` → `withRLS(ctx, ...)` 패턴을 공통으로 따른다(`src/app/(app)/expenses/payees/actions.ts`).
- 인증은 NextAuth 기반이라 Supabase Auth(`auth.uid()`) 기반 Storage RLS는 적용 대상이 아니다. 접근 제어는 지금과 동일하게 서버 액션 레이어(`requireRole`)에서 강제한다.

## 결정 사항

- **저장소**: Supabase Storage, 비공개(private) 버킷 `payee-attachments` 1개. 서비스 롤 키(`SUPABASE_SERVICE_ROLE_KEY`)로 서버에서만 접근. (버킷 생성 및 키 발급, Vercel 환경변수 등록은 완료됨.)
- **업로드 시점**: 즉시 업로드가 아니라 **임시 보관 후 "저장 완료" 클릭 시 일괄 반영**. `FileDropzone`이 이미 네이티브 폼과 호환되므로, 폼 하나를 "저장 완료" 버튼으로 제출하는 것만으로 자연스럽게 구현된다(별도 클라이언트 상태 관리 불필요).
- **교체/삭제**: 두 슬롯(사업자등록증, 통장사본) 모두 교체와 삭제를 지원한다.
- **하단 "드래그 앤 드롭으로 신규 증빙 파일 추가(고유번호 자동 매칭)" 영역**: 상단 두 슬롯과 기능이 완전히 중복되므로(모달이 이미 특정 `payeeId`에 바인딩돼 있어 "자동 매칭"이 의미가 없음) **이번 구현 범위에서 제외**한다.
- **파일 제한**: PDF, JPG, PNG만 허용, 10MB 이하. 버킷 레벨(MIME/크기)과 서버 액션 레벨 이중 검증.
- **다운로드**: 공개 URL이 아니라 서버가 그때그때 발급하는 서명 URL(60초 만료)만 사용한다. 사업자등록증/통장사본은 민감 개인정보이기 때문.

## 스키마 변경

`PayeeAttachment`에 `@@unique([payeeId, fileType])` 추가 (마이그레이션 1건). 유형당 파일 1개로 제약해 "교체"를 update/upsert로 깔끔하게 구현하기 위함.

```prisma
model PayeeAttachment {
  id         String        @id @default(cuid())
  payeeId    String
  payee      Payee         @relation(fields: [payeeId], references: [id], onDelete: Cascade)
  fileType   PayeeFileType
  fileUrl    String
  fileName   String
  uploadedAt DateTime      @default(now())

  @@unique([payeeId, fileType])
  @@index([payeeId])
}
```

## 아키텍처 / 데이터 흐름

1. 사용자가 "첨부파일" 컬럼 버튼 클릭 → `PayeeListPanel`이 선택된 행의 `{ id, keyId, bizName }`을 상태로 저장하고 `PayeeAttachmentModal`을 연다.
2. 모달이 열리며 `getPayeeAttachmentsAction(payeeId)`를 호출해 현재 첨부 상태(`{ bizCert: {id, fileName} | null, bankbook: {id, fileName} | null }`)를 조회한다.
3. 사용자가 슬롯별로 파일을 드래그앤드롭/선택하거나 삭제 체크를 하고 "저장 완료"를 클릭 → `<form>` 전체가 `saveAttachmentsAction`으로 제출된다.
4. `saveAttachmentsAction`이 슬롯별로 독립 처리(업로드/교체/삭제/변경없음) 후 `revalidatePath("/expenses")` → 테이블의 배지(`hasBizCert`/`hasBankbook`)가 갱신된다.
5. 다운로드 클릭 → `getAttachmentDownloadUrlAction(attachmentId)`가 서명 URL을 발급 → 클라이언트가 새 탭으로 연다.

## 컴포넌트 설계

### UI

- **`src/app/(app)/expenses/PayeeAttachmentModal.tsx`** (신규) — `PayeeUploadModal.tsx`와 동일한 커스텀 오버레이 패턴.
  - 상단: "고유번호 바인딩" 라벨 + `고유번호: {keyId} [업체/강사명: {bizName}]`
  - 본문: `AttachmentSlot` 하위 컴포넌트를 BIZ_CERT/BANKBOOK 각각에 대해 렌더링(2개, 완전 독립)
    - 파일 있음: 파일명 + `[다운로드]` + `[교체]`(클릭 시 그 자리에 `FileDropzone` 노출) + `[삭제]`(삭제 예정 표시, 저장 전 취소 가능)
    - 파일 없음: `FileDropzone`(`accept=".pdf,.jpg,.jpeg,.png"`)만 표시
  - 폼 필드: `payeeId`(hidden), `bizCertFile`/`bankbookFile`(FileDropzone의 hidden input), `bizCertDelete`/`bankbookDelete`(hidden, 삭제 예정 플래그)
  - 하단: `[닫기]`(서버 반영 없이 닫기) / `[저장 완료]`(`type="submit"`, `useActionState`의 `pending`일 때 "저장 중...")
  - 저장 성공 시 `router.refresh()` 후 모달 닫기 (`PayeeUploadModal` 패턴과 동일)
- **`PayeeListPanel.tsx` 수정**: `AttachmentCell`의 `<button>`에 `onClick` 연결(선택 행 상태 세팅), "⚠ 미첨부"도 클릭 가능하도록 `<span>` 대신 버튼으로 통일.

### 서버 액션 (`src/app/(app)/expenses/payees/attachment-actions.ts`, 신규)

- **`getPayeeAttachmentsAction(payeeId)`**: `requireRole("SETTLEMENT")` → 첨부 2건 조회 → `{ bizCert, bankbook }` 반환. `fileUrl`(스토리지 경로)은 클라이언트로 보내지 않는다.
- **`saveAttachmentsAction(_prev, formData)`**: `useActionState`용. 슬롯별 독립 처리:
  - 삭제 플래그 → 스토리지 오브젝트 삭제 성공 후 DB row 삭제
  - 새 파일 → MIME/크기 검증 → 스토리지 업로드 → 성공 후 DB upsert(교체 시 이전 오브젝트는 업로드 성공 후 삭제)
  - 한 슬롯 실패해도 다른 슬롯은 반영, 실패한 슬롯만 에러 메시지 반환
  - 처리 후 `revalidatePath("/expenses")`
- **`getAttachmentDownloadUrlAction(attachmentId)`**: 권한 체크 후 서명 URL(60초) 반환.

### 저장소 헬퍼 (`src/lib/storage/payee-attachments.ts`, 신규)

- `uploadPayeeFile`, `deletePayeeFile`, `signedDownloadUrl` — Supabase Storage 클라이언트 호출을 감싼다. `SUPABASE_SERVICE_ROLE_KEY`는 이 파일에서만 읽는다.
- 경로 규칙: `{payeeId}/{fileType}/{cuid}-{원본파일명}`

## 검증 · 에러 처리

- MIME/확장자: `application/pdf`, `image/jpeg`, `image/png`만 허용. 크기 10MB 초과 거부. (버킷 레벨 제한과 이중 방어)
- 권한: `requireRole("SETTLEMENT")` — 기존 업로드 액션과 동일 기준.
- 스토리지 업로드 실패 시 DB row는 건드리지 않는다(파일 없는데 DB row만 생기는 상태 방지).
- 교체는 새 파일 업로드 성공 후에만 기존 오브젝트를 삭제한다(실패 시 기존 파일 보존).
- 삭제는 스토리지 삭제가 실패하면 DB row도 지우지 않는다(고아 파일보다 재시도 유도가 낫다는 기존 코드 스타일과 일치, `uploadPayeesAction` 참고).

## 변경 파일

- `prisma/schema.prisma` — `PayeeAttachment`에 `@@unique([payeeId, fileType])` 추가 + 마이그레이션.
- `src/lib/storage/payee-attachments.ts` — 신규, Supabase Storage 헬퍼.
- `src/app/(app)/expenses/payees/attachment-actions.ts` — 신규, 서버 액션 3개.
- `src/app/(app)/expenses/PayeeAttachmentModal.tsx` — 신규, 팝업 UI.
- `src/app/(app)/expenses/PayeeListPanel.tsx` — `AttachmentCell` 클릭 연결.
- `.env.example` — `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` 키 이름 추가(값 없이).
- `package.json` — `@supabase/supabase-js` 의존성 추가.

## 범위 밖 (변경하지 않음)

- 하단 "드래그 앤 드롭으로 신규 증빙 파일 추가(고유번호 자동 매칭)" 영역은 구현하지 않는다(상단 슬롯과 기능 중복, 사용자 확인 완료).
- 첨부파일 유형 추가(예: 기타 증빙서류)는 하지 않는다. 현재 스키마의 BIZ_CERT/BANKBOOK 2종만 다룬다.
- 업로드 이력(버전 관리)은 남기지 않는다. 교체 시 이전 파일은 삭제된다.
- Supabase Storage 버킷 자체의 RLS 정책 설정은 하지 않는다(서비스 롤 키로 서버에서만 접근하므로 불필요).

## 테스트 계획

- `saveAttachmentsAction` 유닛 테스트: 신규 업로드 / 교체 / 삭제 / 잘못된 형식·용량 초과 거부 / 한쪽 슬롯만 실패 시 다른 슬롯은 반영되는지 (스토리지 헬퍼는 모킹).
- `getPayeeAttachmentsAction` 유닛 테스트: 첨부 있음/없음 조회 결과 매핑.
- `payee-attachments.ts` 저장소 헬퍼 유닛 테스트: Supabase 클라이언트 모킹, 경로 규칙/서명 URL 발급 호출 검증(실제 네트워크 호출 없음).
- 수동 검증: 지급 리스트 화면에서 첨부파일 컬럼 클릭 → 팝업 오픈 → 업로드/교체/삭제/다운로드 각각 확인 → 저장 후 목록 배지 갱신 확인.
