import { formatKstDateTime } from "@/lib/week";

type Stamp = {
  createdByName: string | null; // 최초 제출자(계정이 삭제됐으면 null)
  updatedByName: string | null; // 마지막 저장자
  createdAt: string; // ISO
  editedAt: string | null; // 최초 제출 후 내용이 바뀐 저장 시각(없으면 수정 없음)
};

// 기타 업무의 구분 칩(화면과 입력 검증이 함께 쓴다).
export const WEEKLY_TAGS = ["TF", "타 고객사 지원", "내부 업무", "교육·행사", "기타"] as const;

const GONE = "(삭제된 사용자)";

/**
 * 주간 공유 카드·히스토리에 붙는 작성자·수정자 표기.
 *  - 수정 없음:           "김서연 · 11/3(화) 10:34"
 *  - 같은 사람이 수정:     "김서연 · 11/3(화) 10:34 · 수정됨 11/5(목) 09:10"
 *  - 다른 사람이 수정:     "작성 김서연 11/3(화) 10:34 · 수정 이승준 11/5(목) 09:10"
 */
export function describeShareStamp(v: Stamp): string {
  const creator = v.createdByName ?? GONE;
  const created = formatKstDateTime(v.createdAt);
  if (!v.editedAt) return `${creator} · ${created}`;
  const edited = formatKstDateTime(v.editedAt);
  const editor = v.updatedByName ?? GONE;
  if (editor === creator) return `${creator} · ${created} · 수정됨 ${edited}`;
  return `작성 ${creator} ${created} · 수정 ${editor} ${edited}`;
}

/**
 * 표의 "작성" 칸용 줄 나누기: [작성자, 작성 시각] + 수정이 있으면 [수정 정보].
 *  - 같은 사람이 수정: "수정됨 11/5(목) 09:10" / 다른 사람이 수정: "수정 이승준 11/5(목) 09:10"
 */
export function describeShareStampLines(v: Stamp): string[] {
  const creator = v.createdByName ?? GONE;
  const lines = [creator, formatKstDateTime(v.createdAt)];
  if (v.editedAt) {
    const editor = v.updatedByName ?? GONE;
    const edited = formatKstDateTime(v.editedAt);
    lines.push(editor === creator ? `수정됨 ${edited}` : `수정 ${editor} ${edited}`);
  }
  return lines;
}
