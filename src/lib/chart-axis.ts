// 차트 축 계산. 클라이언트 컴포넌트(차트)가 가져다 쓰므로 서버 전용 모듈(쿠키·DB)을 끌어오지 않는 순수 파일로 둔다.

/** 차트 축의 보기 좋은 최댓값: 1·2·2.5·5·10 × 10^n 중 v를 덮는 가장 작은 수(v ≤ 0이면 1). */
export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
}
