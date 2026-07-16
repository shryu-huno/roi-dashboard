"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setClientEasywelAction } from "./actions";

// 현대이지웰 소개 계약 여부 인라인 토글. 체크 즉시 저장된다.
export function EasywelToggle({ id, defaultOn }: { id: string; defaultOn: boolean }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <input
      type="checkbox"
      defaultChecked={defaultOn}
      disabled={pending}
      onChange={(e) => {
        const on = e.target.checked;
        startTransition(async () => {
          await setClientEasywelAction(id, on);
          router.refresh();
        });
      }}
    />
  );
}
