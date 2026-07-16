"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setEasywelOnlyAction } from "@/app/(app)/dashboard/actions";

// 현대이지웰 고객사만 보기 토글. 체크 시 전사 KPI·차트·요약표가 현대이지웰 고객사만으로 재계산된다.
export function EasywelFilterToggle({ defaultOn }: { defaultOn: boolean }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <label className="flex items-center gap-2 text-sm text-[var(--color-fg)]">
      <input
        type="checkbox"
        defaultChecked={defaultOn}
        disabled={pending}
        onChange={(e) => {
          const on = e.target.checked;
          startTransition(async () => {
            await setEasywelOnlyAction(on);
            router.refresh();
          });
        }}
      />
      현대이지웰만
    </label>
  );
}
