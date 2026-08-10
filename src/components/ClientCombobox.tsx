"use client";

import { useEffect, useRef, useState } from "react";

type Client = { id: string; name: string };

// 검색형 고객사 선택(콤보박스). 입력으로 목록을 걸러 선택하면 숨은 clientId가 채워지고,
// 부모 GET 폼이 그대로 제출된다. 선택 상태는 defaultClientId(= 제출된 clientId)로 초기화되므로
// 조회 후 고른 고객사명은 유지되고, 선택 없이 제출하면 입력창이 다시 비워진다.
export function ClientCombobox({
  clients,
  defaultClientId,
  className = "w-56",
}: {
  clients: Client[];
  defaultClientId?: string;
  className?: string;
}) {
  const selected = clients.find((c) => c.id === defaultClientId);
  const [clientId, setClientId] = useState(selected?.id ?? "");
  const [query, setQuery] = useState(selected?.name ?? "");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // 사이드바 링크(<Link>)로 같은 라우트에 다시 진입하면 컴포넌트가 언마운트되지 않아
  // useState 초기값이 재적용되지 않는다. 제출된 clientId(defaultClientId)가 바뀌면 렌더 중에
  // 입력 상태를 URL에 맞춰 동기화한다 — 선택 없이 진입하면 비우고, 선택된 값이면 그 이름을 채운다.
  const [prevDefault, setPrevDefault] = useState(defaultClientId);
  if (defaultClientId !== prevDefault) {
    setPrevDefault(defaultClientId);
    setClientId(selected?.id ?? "");
    setQuery(selected?.name ?? "");
    setOpen(false);
  }

  const q = query.trim().toLowerCase();
  const filtered = q ? clients.filter((c) => c.name.toLowerCase().includes(q)) : clients;

  // 바깥 클릭 시 목록 닫기.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // 키보드로 이동할 때 하이라이트된 항목이 보이도록 스크롤.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.children[highlight] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  function select(c: Client) {
    setClientId(c.id);
    setQuery(c.name);
    setOpen(false);
  }

  return (
    <div ref={boxRef} className={`relative mt-1 ${className}`}>
      <input type="hidden" name="clientId" value={clientId} />
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setClientId(""); // 다시 고를 때까지 선택 해제
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
              e.preventDefault(); // 폼 제출 대신 항목 선택
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
        aria-controls="client-combobox-list"
        className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-center text-sm"
      />
      {open && filtered.length > 0 && (
        <ul id="client-combobox-list" ref={listRef} className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
          {filtered.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault(); // 입력창 blur보다 먼저 선택 처리
                  select(c);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`block w-full px-3 py-2 text-center text-sm hover:bg-[var(--color-border)] ${
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
