"use client";

import { useEffect, useRef, useState } from "react";

type Client = { id: string; name: string };

// 검색형 고객사 선택(콤보박스). 입력값으로 목록을 걸러 선택하면 숨은 clientId가 채워지고,
// 부모 GET 폼이 그대로 제출된다. 네이티브 <select>는 검색이 안 돼 커스텀으로 구현한다.
export function ClientCombobox({
  clients,
  defaultClientId,
}: {
  clients: Client[];
  defaultClientId?: string;
}) {
  const selected = clients.find((c) => c.id === defaultClientId);
  const [clientId, setClientId] = useState(selected?.id ?? "");
  const [query, setQuery] = useState(selected?.name ?? "");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // 바깥 클릭 시 목록 닫기.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q ? clients.filter((c) => c.name.toLowerCase().includes(q)) : clients;

  return (
    <div ref={boxRef} className="relative">
      <input type="hidden" name="clientId" value={clientId} />
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setClientId(""); // 다시 고를 때까지 선택 해제
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="고객사명 검색"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        className="mt-1 w-56 rounded border border-[var(--color-border)] px-3 py-2 text-sm"
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-60 w-56 overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
          {filtered.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => {
                  setClientId(c.id);
                  setQuery(c.name);
                  setOpen(false);
                }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--color-border)]"
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
