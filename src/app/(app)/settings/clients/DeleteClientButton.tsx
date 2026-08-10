"use client";

import { hardDeleteClientAction } from "./actions";

// 관리자 전용 하드 삭제 버튼. 되돌릴 수 없으므로 고객사명을 강조한 확인창을 둔다.
export function DeleteClientButton({ id, name }: { id: string; name: string }) {
  return (
    <form
      action={hardDeleteClientAction}
      onSubmit={(e) => {
        if (
          !confirm(
            `'${name}' 고객사를 완전히 삭제하시겠습니까?\n과업·지출 등 연관 데이터가 모두 삭제되며 되돌릴 수 없습니다.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="text-[var(--color-danger)]">삭제</button>
    </form>
  );
}
