"use client";

import { restoreClientAction } from "./actions";

// 관리자 전용 고객사 복원(보관 취소) 버튼. 되돌리는 동작이라 확인창은 두지 않는다.
export function RestoreClientButton({ id }: { id: string }) {
  return (
    <form action={restoreClientAction}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="text-[var(--color-primary)]">복원</button>
    </form>
  );
}
