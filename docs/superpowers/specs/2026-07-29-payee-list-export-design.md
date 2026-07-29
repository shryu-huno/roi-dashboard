# 지급 리스트 엑셀 다운로드 기능 설계

## 배경

`/expenses` 페이지의 "지급 리스트" 탭(`PayeeListPanel.tsx`)에는 "📗 엑셀 다운로드" 버튼이 이미 배치돼 있으나 `onClick` 핸들러가 없는 스텁 상태다. 이 문서는 현재 화면(검색/필터 적용된 상태)에 보이는 지급 리스트를 엑셀로 다운로드하는 기능의 설계를 정리한다.

## 현재 상태 (조사 결과)

- 탭/데이터 접근 권한: "지급 리스트" 탭은 `ADMIN`/`SETTLEMENT`만 접근 가능(PM은 탭 자체에 접근 불가). `listPayees()`도 동일하게 이 두 역할 외에는 예외를 던진다.
- 검색/필터는 URL 쿼리(`field`, `q`)를 GET 폼으로 서버에 재조회하는 방식이며 페이지네이션은 없다. 즉 "현재 화면"은 곧 "현재 쿼리로 조회된 전체 결과"다.
- `PayeeRow`(화면에 내려가는 타입, `src/lib/data/payees.ts`)에는 사업자번호 **마스킹 값만** 포함되고 원문은 없다. 계좌번호는 이미 복호화된 원문이 포함되어 있다.
- 엑셀 생성은 `exceljs` 사용. 기존 등록용 서식 다운로드(`buildTemplateXlsxBuffer`, `src/app/(app)/expenses/payees/xlsx.ts`)에 열너비 자동계산/헤더 스타일/테두리/헤더행 고정 로직이 이미 있고, 다운로드 라우트 패턴(`template/route.ts`)도 참고할 수 있다.
- "등록된 지급리스트 데이터를 엑셀로 export"하는 기능은 지금까지 없었다(있는 것은 빈 등록 서식 다운로드 + 업로드뿐).

## 결정 사항

- **다운로드 범위**: 현재 화면에 적용된 검색/필터(`field`, `q`) 조건을 그대로 반영한 목록. 별도 페이지네이션이 없으므로 "필터링된 전체 결과"를 다운로드한다.
- **컬럼**: 고유번호, 사업자명(이름), 사업자번호, 연락처, 은행명, 계좌번호, 예금주, 청구방식, 사업자등록증 첨부, 통장사본 첨부 (10개 컬럼, 첨부파일 여부는 종류별로 분리).
- **사업자번호 원문 노출**: 다운로드 파일에는 마스킹이 아닌 복호화 원문을 포함한다. 이 화면(및 다운로드 라우트)에 도달 가능한 역할이 이미 `ADMIN`/`SETTLEMENT`뿐이므로 별도의 역할 분기 없이 기존 role 체크에 얹으면 요구사항("정산담당자와 관리자는 원문으로 볼 수 있게")이 자연히 충족된다.
- **다운로드 방식**: GET 라우트 링크. 기존 서식 다운로드와 동일한 패턴으로, 검색 폼의 `field`/`q` 값을 쿼리 파라미터로 그대로 전달한다.
- **파일명**: `지급리스트_YYYYMMDD.xlsx` (한국 시간 기준 날짜, 검색어는 파일명에 포함하지 않음).
- **엑셀 스타일링**: 기존 등록 서식과 동일한 수준(열너비 자동조정, 헤더 굵게+배경색, 테두리, 헤더행 고정, 사업자번호/계좌번호 텍스트 서식). 단, 읽기 전용 결과물이므로 드롭다운·유효성검사·메모·시트보호는 적용하지 않는다.
- **결과 0건 처리**: 다운로드 버튼을 비활성화하고(`title` 툴팁으로 안내), 별도 에러 응답 케이스는 만들지 않는다.
- **감사 로그**: 이번 범위에서는 도입하지 않는다(탭 자체가 이미 두 역할로 제한되어 있어 추가 기록 없이 진행).

## 아키텍처 / 데이터 흐름

```
[PayeeListPanel 다운로드 링크] --GET /expenses/payees/export?field=&q=--> [export/route.ts]
                                                                              |
                                                                requireRole("SETTLEMENT")
                                                                              |
                                                          listPayeesForExport(ctx, filter)  (신규)
                                                                              |
                                                        buildExportXlsxBuffer(rows)   (신규, xlsx.ts)
                                                                              |
                                                              xlsx 파일 응답 (다운로드)
```

## 변경 파일

### `src/lib/data/payees.ts`

- 기존 `listPayees()`의 역할체크 + DB 조회 + 인메모리 검색필터링 로직(121~140행)을 비공개 헬퍼 `fetchMatchedPayees(ctx, filter)`로 분리한다. 반환값은 `attachments` 포함 원본 Prisma row 배열.
- `listPayees()`는 이 헬퍼 결과를 기존과 동일하게 `PayeeRow`로 매핑한다(동작 변화 없음).
- 신규 `listPayeesForExport(ctx, filter)`: 같은 헬퍼 결과를 아래 `PayeeExportRow`로 매핑하되 `bizNumber: decrypt(r.bizNumberEnc)` 원문을 추가로 포함한다.

```ts
export type PayeeExportRow = {
  keyId: string;
  bizName: string;
  bizNumber: string; // 복호화 원문
  phone: string;
  bankName: string;
  accountNumber: string; // 복호화 원문
  accountHolder: string;
  taxType: TaxType;
  hasBizCert: boolean;
  hasBankbook: boolean;
};
```

역할체크가 헬퍼 안에 있으므로 `listPayeesForExport`도 자동으로 `ADMIN`/`SETTLEMENT` 외 역할에서 예외를 던진다.

### `src/app/(app)/expenses/payees/xlsx.ts`

신규 함수 `buildExportXlsxBuffer(rows: PayeeExportRow[]): Promise<Buffer>` 추가.

- 헤더: `["고유번호", "사업자명(이름)", "사업자번호", "연락처", "은행명", "계좌번호", "예금주", "청구방식", "사업자등록증 첨부", "통장사본 첨부"]`
- 기존 `displayWidth`/`colLetter` 헬퍼 재사용, 열너비 자동계산 + 헤더 굵게/배경색 + 테두리 + 가운데정렬 + 헤더행 고정을 `buildTemplateXlsxBuffer`와 동일한 수준으로 적용.
- 사업자번호·계좌번호 컬럼은 `numFmt = "@"`(텍스트 서식)로 선행 0/자릿수 손실을 방지.
- 청구방식은 `taxTypeLabel()`로 한글 라벨 변환. 첨부 두 컬럼은 `hasBizCert`/`hasBankbook`을 "O"/"X"로 표기.
- 드롭다운/유효성검사/메모/시트보호는 적용하지 않는다(등록용 서식과 달리 읽기 전용 결과물).

### `src/app/(app)/expenses/payees/export/route.ts` (신규)

- GET 핸들러. `requireRole("SETTLEMENT")`로 권한 확인(ADMIN은 랭크상 자동 통과) — 기존 `template/route.ts`, `attachment-download/route.ts`와 동일한 패턴.
- 쿼리 파라미터 `field`/`q`를 `parsePayeeSearchField`로 파싱해 `listPayeesForExport(ctx, filter)` 호출.
- `buildExportXlsxBuffer(rows)`로 버퍼 생성 후 `Content-Disposition: attachment`로 응답.
- 파일명: 한국 시간 기준 `new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" })`(기존 `performance/page.tsx`에서 쓰는 패턴)로 `YYYY-MM-DD`를 얻어 하이픈 제거 후 `지급리스트_YYYYMMDD.xlsx`로 조합.

### `src/app/(app)/expenses/PayeeListPanel.tsx`

- "📗 엑셀 다운로드" 버튼(135~137행)을 `rows.length > 0`일 때 `<a href="/expenses/payees/export?field=...&q=...">` 링크로, 0건일 때는 `disabled` + `title="다운로드할 데이터가 없습니다"` 버튼으로 분기.
- 링크의 `field`/`q`는 현재 서버에서 받은 값(검색 폼과 동일한 소스)을 사용한다. 사용자가 검색창 값을 바꾸고 아직 [조회]를 누르지 않은 상태라면, 다운로드도 검색 폼과 마찬가지로 "마지막으로 조회된" 상태 기준으로 동작한다(일관된 동작이므로 별도 처리 없음).

## 범위 밖 (변경하지 않음)

- 페이지네이션 도입 안 함(기존에도 없음, 이번 변경과 무관).
- 감사 로그(다운로드 이력 기록) 도입 안 함.
- 사업자 구분(강사/업체, `payeeType`) 컬럼은 사용자가 요청한 컬럼 목록에 없으므로 추가하지 않는다.
- 업로드/등록 서식(`buildTemplateXlsxBuffer`, `template/route.ts`)은 변경하지 않는다.

## 테스트 계획

- 단위 테스트(`buildExportXlsxBuffer`): 헤더 순서/내용, 사업자번호·계좌번호가 텍스트 서식으로 선행 0을 보존하는지, 청구방식이 한글 라벨로 변환되는지, 첨부 여부가 O/X로 표기되는지.
- 단위 테스트(`listPayeesForExport`): 기존 `listPayees` 필터링 테스트와 동일한 케이스에 대해 `bizNumber` 원문이 포함되는지, role 체크가 동일하게 동작하는지.
- 수동 검증: 지급 리스트 화면에서 검색 필터 적용 후 다운로드 → 파일 내용이 화면과 일치하는지, 필터 없이 전체 다운로드, 검색 결과 0건일 때 버튼 비활성화 확인, 다운로드된 파일에서 사업자번호/계좌번호가 원문으로 보이는지, 파일명 형식 확인.
