"use client";

import { useRef } from "react";

const fieldCls =
  "h-[38px] rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] text-center text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-primary)]";

// 직접 입력 칸. 입력은 Enter 또는 칸을 벗어날 때 확정하고, 올바르지 않은 값이면 원래 값으로 되돌린다.
// 값이 바뀌어 다시 그려질 때는 key로 새로 만들어 항상 현재 값이 보이게 한다.
export function CommitInput({
  value, parse, onCommit, suffix, className, label,
}: {
  value: number;
  parse: (text: string) => number | null;
  onCommit: (n: number) => void;
  suffix: string;
  className: string;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  function commit() {
    const n = parse(ref.current?.value ?? "");
    if (n === null || n === value) {
      if (ref.current) ref.current.value = String(value);
      return;
    }
    onCommit(n);
  }
  return (
    <span className="relative inline-flex items-center">
      <input
        ref={ref}
        key={value}
        type="text"
        inputMode="numeric"
        aria-label={label}
        defaultValue={value}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.currentTarget.value = String(value);
            e.currentTarget.blur();
          }
        }}
        className={`${fieldCls} ${className}`}
      />
      <span className="pointer-events-none absolute right-3 text-sm text-[var(--color-muted)]">{suffix}</span>
    </span>
  );
}
