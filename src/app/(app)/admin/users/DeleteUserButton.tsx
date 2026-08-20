"use client";

import { hardDeleteUser } from "./actions";

// 최고관리자 전용 하드 삭제 버튼. 되돌릴 수 없으므로 이메일을 강조한 확인창을 둔다.
export function DeleteUserButton({ id, email }: { id: string; email: string }) {
  return (
    <form
      action={hardDeleteUser}
      onSubmit={(e) => {
        if (!confirm(`'${email}' 계정을 완전히 삭제하시겠습니까?\n되돌릴 수 없습니다.`)) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="userId" value={id} />
      <button type="submit" className="rounded border border-[var(--color-danger)] px-2 py-1 text-[var(--color-danger)]">
        완전 삭제
      </button>
    </form>
  );
}
