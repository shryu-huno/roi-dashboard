"use client";

import { archiveClientAction } from "./actions";

// 관리자 전용 고객사 삭제(보관) 버튼. 확인창으로 "숨김·데이터 보존"임을 안내한다.
export function ArchiveClientButton({ id, name }: { id: string; name: string }) {
  return (
    <form
      action={archiveClientAction}
      onSubmit={(e) => {
        if (!confirm(`'${name}' 고객사를 삭제하시겠습니까?\n목록에서 숨겨지며 데이터는 보존됩니다.`)) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="text-[var(--color-danger)]">삭제</button>
    </form>
  );
}
