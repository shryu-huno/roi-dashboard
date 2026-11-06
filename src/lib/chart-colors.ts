// 차트 범주 색(밝은 화면용). 데이터 시각화 가이드의 검증된 팔레트 순서를 그대로 쓴다.
// 이 순서의 인접 쌍이 색각 이상(CVD)·일반 시야 분리 기준을 통과하도록 정해진 것이라 순서를 바꾸지 않는다.
// 앞의 세 슬롯(파랑·주황·청록)은 전부 통과하며, 청록은 표면 대비가 3:1 미만이라(2.74) 값 라벨과 표 보기를 함께 제공한다.
// 색은 순위가 아니라 대상(파트)을 따라간다: 필터로 계열 수가 바뀌어도 파트의 색은 그대로다.
export const CATEGORICAL = [
  "#2a78d6", // 1 blue
  "#eb6834", // 2 orange
  "#1baf7a", // 3 aqua
  "#eda100", // 4 yellow
  "#e87ba4", // 5 magenta
  "#008300", // 6 green
  "#6250d6", // 7 violet
  "#e34948", // 8 red
] as const;

export const colorAt = (i: number) => CATEGORICAL[i % CATEGORICAL.length];

// 단일 계열 미터: 채움은 파랑 450, 빈 트랙은 같은 램프의 밝은 단계(파랑 100).
export const METER = { fill: "#2a78d6", track: "#cde2fb" } as const;
