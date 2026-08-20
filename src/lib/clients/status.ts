// 고객사·프로젝트 상태값은 "진행중"/"계약만료" 둘 뿐이다.
// 계약 종료일이 지나면 저장값과 무관하게 "계약만료"로 자동 표시한다(별도 배치 없이 조회 시 파생).
export const STATUS_ONGOING = "진행중";
export const STATUS_EXPIRED = "계약만료";
export const STATUS_OPTIONS = [STATUS_ONGOING, STATUS_EXPIRED] as const;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// 오늘이 계약 종료일을 "넘어간" 경우에만 만료(종료일 당일은 아직 진행중).
function isPastEnd(contractEnd: Date | string | null | undefined, now: Date): boolean {
  if (!contractEnd) return false;
  const end = typeof contractEnd === "string" ? new Date(contractEnd) : contractEnd;
  return ymd(now) > ymd(end);
}

// 저장값을 두 상태 중 하나로 정규화(레거시/빈 값은 진행중).
function normalize(status: string | null | undefined): string {
  return status === STATUS_EXPIRED ? STATUS_EXPIRED : STATUS_ONGOING;
}

// 프로젝트 표시 상태: 계약 종료일이 지났으면 계약만료, 아니면 저장값.
export function effectiveProjectStatus(
  status: string | null | undefined,
  contractEnd: Date | string | null | undefined,
  now: Date = new Date(),
): string {
  if (isPastEnd(contractEnd, now)) return STATUS_EXPIRED;
  return normalize(status);
}

// 고객사 표시 상태: 프로젝트가 하나라도 있고 전부 만료됐으면 계약만료, 아니면 저장값.
export function effectiveClientStatus(
  status: string | null | undefined,
  projects: { status: string; contractEnd: Date | string | null }[],
  now: Date = new Date(),
): string {
  const allExpired =
    projects.length > 0 &&
    projects.every((p) => effectiveProjectStatus(p.status, p.contractEnd, now) === STATUS_EXPIRED);
  if (allExpired) return STATUS_EXPIRED;
  return normalize(status);
}
