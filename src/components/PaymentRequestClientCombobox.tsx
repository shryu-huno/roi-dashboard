"use client";

import { useEffect, useRef, useState } from "react";

type ClientOption = { id: string; name: string };

// PM 지급요청 등록 화면의 고객사 검색형 선택. PayeeCombobox와 동일한 콜백 패턴이지만
// 필터바용 ClientCombobox(hidden input 패턴)와는 다른 용도라 별도 컴포넌트로 둔다.
// 등록된 고객사만 선택 가능 — 목록에 없는 이름을 입력하면 선택되지 않은 상태로 남는다
// (신규 고객사 자동 등록 없음, 저장 시 상위에서 검증으로 막는다).
export function PaymentRequestClientCombobox({
  clients,
  selectedId,
  onSelect,
  className = "w-full",
  hasError = false,
}: {
  clients: ClientOption[];
  selectedId: string | null;
  onSelect: (client: ClientOption | null) => void;
  className?: string;
  hasError?: boolean;
}) {
  const selected = clients.find((c) => c.id === selectedId) ?? null;
  const [query, setQuery] = useState(selected?.name ?? "");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const [prevSelectedId, setPrevSelectedId] = useState(selectedId);
  if (selectedId !== prevSelectedId) {
    setPrevSelectedId(selectedId);
    setQuery(selected?.name ?? "");
    setOpen(false);
  }

  const q = query.trim().toLowerCase();
  const filtered = q ? clients.filter((c) => c.name.toLowerCase().includes(q)) : clients;

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function select(c: ClientOption) {
    setQuery(c.name);
    setOpen(false);
    onSelect(c);
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
        placeholder="고객사명 검색"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        className={`w-full rounded border ${hasError ? "border-[var(--color-danger)]" : "border-[var(--color-border)]"} px-2 py-1.5 text-center text-sm`}
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-96 w-full overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
          {filtered.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(c);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`block w-full px-2 py-1.5 text-center text-sm hover:bg-[var(--color-border)] ${
                  i === highlight ? "bg-[var(--color-border)]" : ""
                }`}
              >
                {c.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
