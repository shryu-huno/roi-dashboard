"use client";

import { useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

// 누적표 집계 기준 전환 스위치. Off = 최신연도 기준(기본), On = 프로젝트 기준.
// 상태는 URL 쿼리(basis)로 유지해 고객사·연도·월 조회값과 함께 보존된다.
export function TotalsBasisToggle({ on }: { on: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    const next = new URLSearchParams(params.toString());
    if (on) next.delete("basis");
    else next.set("basis", "project");
    startTransition(() => router.push(`${pathname}?${next.toString()}`));
  };

  return (
    <div className="flex items-center gap-2 text-sm text-[var(--color-fg)]">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={pending}
        onClick={toggle}
        className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-[var(--color-border)] transition-colors disabled:opacity-50"
        style={{ backgroundColor: on ? "var(--color-primary)" : "var(--color-surface)" }}
      >
        <span
          className="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform"
          style={{ transform: on ? "translateX(18px)" : "translateX(2px)" }}
        />
      </button>
      <span>{on ? "프로젝트 기준" : "최신연도 기준"}</span>
    </div>
  );
}
