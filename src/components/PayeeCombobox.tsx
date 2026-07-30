"use client";

import { useEffect, useRef, useState } from "react";
import type { PayeeOption } from "@/lib/data/payees";

// 사업자명(이름) 검색형 선택. 동명이인/동일업체명 구분을 위해 후보 목록에는
// "이름 (고유번호)"를 보여주고, 선택하면 입력창에는 이름만 남긴다.
export function PayeeCombobox({
  payees,
  selectedId,
  onSelect,
  className = "w-full",
}: {
  payees: PayeeOption[];
  selectedId: string | null;
  onSelect: (payee: PayeeOption | null) => void;
  className?: string;
}) {
  const selected = payees.find((p) => p.id === selectedId) ?? null;
  const [query, setQuery] = useState(selected?.bizName ?? "");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  // 부모가 selectedId를 바꾸면(예: 다른 행 데이터 로드) 입력값을 동기화.
  const [prevSelectedId, setPrevSelectedId] = useState(selectedId);
  if (selectedId !== prevSelectedId) {
    setPrevSelectedId(selectedId);
    setQuery(selected?.bizName ?? "");
    setOpen(false);
  }

  const q = query.trim().toLowerCase();
  const filtered = q ? payees.filter((p) => p.bizName.toLowerCase().includes(q)) : payees;

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function select(p: PayeeOption) {
    setQuery(p.bizName);
    setOpen(false);
    onSelect(p);
  }

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          onSelect(null);
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
        placeholder="사업자명(이름) 검색"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        className="w-full rounded border border-[var(--color-border)] px-2 py-1.5 text-sm"
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-52 w-full overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
          {filtered.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(p);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`block w-full px-2 py-1.5 text-left text-sm hover:bg-[var(--color-border)] ${
                  i === highlight ? "bg-[var(--color-border)]" : ""
                }`}
              >
                {p.bizName} ({p.keyId})
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
