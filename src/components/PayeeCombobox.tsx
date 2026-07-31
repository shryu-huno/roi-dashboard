"use client";

import { useEffect, useRef, useState } from "react";
import type { PayeeOption } from "@/lib/data/payees";
import { taxTypeLabel } from "@/lib/labels";
import { FloatingList } from "./FloatingList";

// 사업자명(이름) 검색형 선택. 동명이인/동일업체명 구분을 위해 후보 목록에는
// "이름 (고유번호)"를 보여주고, 선택하면 입력창에는 이름만 남긴다. 선택된 사업자가 있을 때
// 입력칸에 마우스를 올리면 그 사업자의 청구방식을 툴팁으로 보여준다(치우면 사라짐).
export function PayeeCombobox({
  payees,
  selectedId,
  onSelect,
  className = "w-full",
  hasError = false,
}: {
  payees: PayeeOption[];
  selectedId: string | null;
  onSelect: (payee: PayeeOption | null) => void;
  className?: string;
  hasError?: boolean;
}) {
  const selected = payees.find((p) => p.id === selectedId) ?? null;
  const [query, setQuery] = useState(selected?.bizName ?? "");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [hover, setHover] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const suppressSyncRef = useRef(false);

  // 부모가 selectedId를 바꾸면(예: 다른 행 데이터 로드) 입력값을 동기화.
  // 단, 타이핑 중 onChange가 onSelect(null)을 호출해 selectedId가 바뀐 경우는
  // suppressSyncRef로 걸러 query를 되돌리지 않는다(그렇지 않으면 첫 키 입력이 씹힌다).
  const [prevSelectedId, setPrevSelectedId] = useState(selectedId);
  if (selectedId !== prevSelectedId) {
    setPrevSelectedId(selectedId);
    if (suppressSyncRef.current) {
      suppressSyncRef.current = false;
    } else {
      setQuery(selected?.bizName ?? "");
      setOpen(false);
    }
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
          suppressSyncRef.current = true;
          onSelect(null);
          setOpen(true);
          setHighlight(0);
        }}
        onFocus={() => setOpen(true)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
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
        className={`w-full rounded border ${hasError ? "border-[var(--color-danger)]" : "border-[var(--color-border)]"} px-2 py-1.5 text-sm`}
      />
      {hover && selected && (
        <div className="absolute -top-8 left-0 z-20 whitespace-nowrap rounded bg-[var(--color-fg)] px-2 py-1 text-xs text-[var(--color-surface)] shadow-lg">
          청구방식: {taxTypeLabel(selected.taxType)}
        </div>
      )}
      <FloatingList anchorRef={boxRef} open={open && filtered.length > 0}>
        <ul className="mt-1 max-h-96 w-full overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
          {filtered.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(p);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`block w-full px-2 py-1.5 text-center text-sm hover:bg-[var(--color-border)] ${
                  i === highlight ? "bg-[var(--color-border)]" : ""
                }`}
              >
                {p.bizName} ({p.keyId})
              </button>
            </li>
          ))}
        </ul>
      </FloatingList>
    </div>
  );
}
