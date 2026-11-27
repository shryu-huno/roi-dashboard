"use client";

import { useEditor } from "./UserAdminProvider";
import type { EditUser } from "./UserEditPanel";

// 표 행의 작업 버튼. 승인 대기면 "승인하기"(강조), 그 외엔 "편집". 클릭 시 드로어를 연다.
export function EditUserButton({ user }: { user: EditUser }) {
  const { openEditor } = useEditor();
  const pending = user.status === "PENDING";
  const cls = pending
    ? "rounded bg-[var(--color-primary)] px-3 py-1.5 text-xs text-white"
    : "rounded border border-[var(--color-border)] px-3 py-1.5 text-xs";
  return (
    <button type="button" className={cls} onClick={() => openEditor(user)}>
      {pending ? "승인하기" : "편집"}
    </button>
  );
}
