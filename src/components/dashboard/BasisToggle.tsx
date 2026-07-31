"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setFiscalBasisAction } from "@/app/(app)/dashboard/actions";

// 집계 기준 전환 스위치. On = 회계연도 기준, Off = 프로젝트 기준(기본).
export function BasisToggle({ defaultOn }: { defaultOn: boolean }) {
  const [on, setOn] = useState(defaultOn);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const toggle = () => {
    const next = !on;
    setOn(next);
    startTransition(async () => {
      await setFiscalBasisAction(next);
      router.refresh();
    });
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
      <span>{on ? "회계연도 기준" : "프로젝트 기준"}</span>
    </div>
  );
}
