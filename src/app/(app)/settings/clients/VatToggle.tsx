"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setIncludeVatAction } from "./actions";

// 부가세 포함 여부 토글. 체크 시 전사·고객사별 대시보드와 CSV의 표시 금액이 부가세 포함(×1.1)으로 바뀐다.
export function VatToggle({ defaultOn }: { defaultOn: boolean }) {
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
            await setIncludeVatAction(on);
            router.refresh();
          });
        }}
      />
      부가세 포함
    </label>
  );
}
