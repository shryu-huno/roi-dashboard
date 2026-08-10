"use client";

import { useEffect, useRef, useState } from "react";
import { FloatingList } from "./FloatingList";

// 자유 텍스트 입력 + 자동완성 제안. ClientCombobox/PayeeCombobox와 달리 특정 엔티티(id)에
// 묶이지 않는 순수 텍스트 필터용이라 숨은 id 필드가 없다 — 이 <input> 자체가 그대로
// GET 폼 값(name)으로 제출된다. 제안을 클릭하면 그 텍스트로 채워지지만, 목록에 없는 값을
// 그대로 입력해 제출해도 된다(부분일치 검색이라 자유 입력을 막지 않는다).
export function SuggestInput({
  name,
  defaultValue = "",
  suggestions,
  placeholder,
  className = "w-full",
}: {
  name: string;
  defaultValue?: string;
  suggestions: string[];
  placeholder?: string;
  className?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const q = value.trim().toLowerCase();
  const filtered = q ? suggestions.filter((s) => s.toLowerCase().includes(q)) : suggestions;

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function select(s: string) {
    setValue(s);
    setOpen(false);
  }

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <input
        type="text"
        name={name}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setOpen(true);
          setHighlight(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setHighlight((h) => Math.min(h + 1, filtered.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            if (open && filtered[highlight]) {
              e.preventDefault();
              select(filtered[highlight]);
            }
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${name}-suggest-list`}
        className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2 text-center text-sm"
      />
      <FloatingList anchorRef={boxRef} open={open && filtered.length > 0}>
        <ul id={`${name}-suggest-list`} className="max-h-60 w-full overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
          {filtered.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(s);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`block w-full px-2 py-2 text-center text-sm hover:bg-[var(--color-hover)] ${
                  i === highlight ? "bg-[var(--color-hover)]" : ""
                }`}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      </FloatingList>
    </div>
  );
}
