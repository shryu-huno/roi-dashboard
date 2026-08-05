# 지급요청 재업로드 지급일 파싱 유연화 설계

## 배경

지급요청 엑셀 재업로드([2026-07-31-payment-request-paydate-status-upload-design.md](./2026-07-31-payment-request-paydate-status-upload-design.md)에서 구현)에서 `지급일` 셀은 `^\d{4}-\d{2}-\d{2}$` 정규식만 통과시킨다. 실사용 중 다음 두 입력이 모두 업로드 실패로 이어졌다:

1. 지급일 컬럼(텍스트 서식 `numFmt:"@"`)에 `8/15`처럼 연도 없이 입력.
2. 해당 셀의 서식을 텍스트에서 "간단한 날짜"로 바꾼 뒤 `8/15` 입력 — Excel이 이를 실제 날짜값으로 인식해 현재 연도를 채워 저장하지만, 표시 서식(로캘/포맷)에 따라 `.text`로 읽었을 때 `YYYY-MM-DD`와 다르게 보일 수 있음.

다양한 자료에서 복사해 붙여넣어도 최대한 인식되도록 파싱 범위를 넓힌다.

## 현재 상태 (조사 결과)

- `src/app/(app)/expenses/payees/xlsx.ts`의 `parseXlsxToRows`는 모든 셀을 `row.getCell(c).text`(화면 표시 텍스트)로만 읽어 `string[][]`로 변환한다. 이 함수는 지급요청 재업로드와 지급대상자(payees) 업로드가 공유한다.
- `src/lib/data/payment-request-upload.ts`의 `parseDateCell`은 `YYYY-MM-DD` 형식만 허용하고, 달력 유효성(예: 2/30 거부)까지 검증한 뒤 `T00:00:00.000Z` UTC 자정 `Date`로 변환한다 — 이 UTC 자정 규약은 export 쪽 `formatPayDate`(KST 달력일 기준)와 반드시 짝이 맞아야 한다(파일 상단 주석에 이미 명시).
- 엑셀 다운로드 템플릿(`payment-request/xlsx.ts`)은 `지급일` 컬럼에 실제 `Date` 값이 아니라 KST 기준으로 포맷된 문자열(`formatPayDate`)을 텍스트 서식(`numFmt:"@"`)으로 써넣는다. 즉 다운로드 직후 재업로드는 항상 성공하며, 문제는 사용자가 값을 직접 수정/재입력할 때만 발생한다.
- exceljs는 셀이 실제 Excel 날짜 타입일 때 `cell.type === ExcelJS.ValueType.Date`이고 `cell.value`가 UTC 자정 기준 `Date` 객체다(Excel 날짜 직렬값에는 타임존이 없으므로 exceljs가 그대로 UTC로 해석). 즉 셀 서식이나 로캘과 무관하게 `cell.value`의 UTC 연/월/일이 사용자가 의도한 달력일과 정확히 일치한다.

## 결정 사항

- **Date 타입 셀 직접 처리**: `parseXlsxToRows`에서 셀이 `ValueType.Date`이면 `.text` 대신 `cell.value`(Date)의 UTC 연/월/일을 `YYYY-MM-DD`로 정규화해 배열에 넣는다. 그 외 타입은 기존처럼 `.text` 그대로 사용. Date 타입 분기라 payees 업로드(날짜 컬럼 없음) 동작에는 영향 없음.
- **텍스트 파싱 확장** (`parseDateCell`):
  - 연도 포함: `yyyy` + 구분자(`-`, `.`, `/` 중 아무거나, 앞뒤 달라도 무방) + `m`/`mm` + 구분자 + `d`/`dd`. 월/일 앞자리 0 생략 허용(`2026.8.15`, `2026/8/15` 등).
  - 연도 생략: `m`/`mm` + 구분자(`-`, `.`, `/`) + `d`/`dd` (예: `8/15`, `8.15`, `8-15`). 연도는 **파싱 시점의 KST 기준 올해**로 채운다.
  - 두 패턴 모두 항상 "월-일" 순서로 해석(일-월 순서 미지원 — 모호성 위험 회피).
  - 기존 달력 유효성 검증(존재하지 않는 날짜 거부)은 두 패턴 모두에 그대로 적용.
- **명시적 범위 제외**: 일/월 순서가 바뀐 표기(`31/7` 등 DD/MM), 한글 혼합 표기(`2026년 8월 15일`), 2자리 연도(`26-8-15`) — 이번 스펙에서 다루지 않는다.
- **에러 메시지**: 기존 문구("지급일 형식이 올바르지 않습니다(YYYY-MM-DD)") 유지 — 이번 변경은 파서를 관대하게 만드는 것이지 사용자에게 문법을 재교육하는 것이 아니므로, 문구 변경은 범위 밖.

## 변경 파일

### `src/app/(app)/expenses/payees/xlsx.ts`

- `parseXlsxToRows` 루프 내부에서 셀 조회 시 타입 분기 추가:
  ```ts
  const cell = row.getCell(c);
  const text =
    cell.type === ExcelJS.ValueType.Date && cell.value instanceof Date
      ? formatUtcDateAsIsoDate(cell.value) // 신규 헬퍼, 이 파일 내부에 추가
      : (cell.text ?? "").toString();
  ```
- 신규 로컬 헬퍼 `formatUtcDateAsIsoDate(d: Date): string` — `d.getUTCFullYear()/getUTCMonth()/getUTCDate()`를 `YYYY-MM-DD`로 조합(0 패딩).

### `src/lib/data/payment-request-upload.ts`

- `parseDateCell`을 두 정규식(연도 포함/생략)을 시도하도록 재작성:
  - 연도 포함 매치 시 기존 로직(UTC Date 생성 + 달력 유효성 왕복 검증) 재사용.
  - 연도 생략 매치 시, KST 기준 올해(`new Date().toLocaleString(...)` 또는 `Intl.DateTimeFormat`으로 Asia/Seoul 연도 추출)를 채운 뒤 동일한 검증 경로 통과.
  - 두 정규식 모두 불일치하면 기존처럼 `undefined` 반환(호출부의 에러 처리 변경 없음).

## 범위 밖 (변경하지 않음)

- 일-월 순서 표기, 한글 혼합 표기, 2자리 연도 — 위 "명시적 범위 제외" 참고.
- 지급일 이외의 컬럼(No, 지급여부) 파싱 로직은 변경하지 않음.
- 엑셀 다운로드 템플릿(`payment-request/xlsx.ts`)은 변경하지 않음 — 이미 KST 문자열을 텍스트 서식으로 내보내고 있어 다운로드 자체는 항상 재업로드 가능한 형식.
- payees 업로드(`build-inputs.ts`)의 날짜 관련 로직 없음 — 이번 변경의 영향 범위 밖.

## 테스트 계획

- 단위 테스트(`parseDateCell`, 또는 이를 통해 `buildPaymentRequestUpdatesFromRows`):
  - 기존: `2026-08-15` 통과, `2026-02-30` 거부(달력 유효성).
  - 신규 통과 케이스: `2026.8.15`, `2026/8/15`, `8/15`(올해로 채워짐), `8.15`, `8-15`.
  - 신규 거부 케이스: `15/8`(일-월 순서), `26-8-15`(2자리 연도), `2026년 8월 15일`.
  - 연도 생략 시 채워지는 연도가 "현재 KST 연도"와 일치하는지(테스트에서 연도를 고정하기 어려우면 `new Date().getFullYear()` 기준으로 비교하거나 시스템 시간을 모킹).
- 단위 테스트(`parseXlsxToRows`): exceljs로 실제 `Date` 타입 셀(예: `cell.value = new Date(Date.UTC(2026,7,15))`)을 만든 워크시트를 읽었을 때 `"2026-08-15"` 문자열로 정규화되는지.
- 회귀 확인: 기존 `test/payment-request-upload.test.ts`, `test/payment-request-xlsx.test.ts`가 계속 통과하는지.
- 수동 검증: 다운로드한 엑셀에서 지급일 셀에 `8/15` 직접 입력(텍스트 서식 유지) 후 재업로드 → 반영 확인. 같은 셀의 서식을 "간단한 날짜"로 바꾸고 `8/15` 재입력 후 재업로드 → 반영 확인.
