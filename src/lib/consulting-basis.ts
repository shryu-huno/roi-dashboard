// 상담비(ConsultingExpense) 집계 기준 유틸. sessionDate('YYYY-MM-DD' 문자열) 기반.
// 프로젝트 기준 = 실시일시(sessionDate), 회계연도 기준 = 지급월(year·month).
const pad = (n: number) => String(n).padStart(2, "0");

// 프로젝트 기준(실시일시) sessionDate 범위 필터값. [from-01, to-31] 문자열 비교(사전식=시간순).
// 말일을 -31로 잡아 해당 월 전체를 포함한다(존재하지 않는 날짜 상한이라 과잉 포함 없음).
export function sessionDateBetween(
  from: { year: number; month: number },
  to: { year: number; month: number },
) {
  return { gte: `${from.year}-${pad(from.month)}-01`, lte: `${to.year}-${pad(to.month)}-31` };
}

// sessionDate 문자열에서 월(1~12) 추출.
export const sessionMonth = (d: string) => Number(d.slice(5, 7));
