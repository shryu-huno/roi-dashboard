"use client";

import { useEffect, useRef, useState } from "react";
import { FloatingList } from "./FloatingList";

type Option = { value: string; label: string };

// 고정된 옵션 목록(검색 없음)을 위한 커스텀 드롭다운. GET 폼에서 네이티브 <select>를
// 대체 — 네이티브 select의 옵션 팝업은 브라우저가 직접 그려서 가운데 정렬/테두리 색상 등
// CSS 커스터마이징이 통하지 않기 때문에, 이 컴포넌트가 그 자리를 채운다.
// 폼 제출값은 숨은 input(name)으로 전달된다(ClientCombobox의 hidden input 패턴과 동일).
export function SelectDropdown({
  name,
  options,
  defaultValue = "",
  className = "w-24",
}: {
  name: string;
  options: Option[];
  defaultValue?: string;
  className?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  // 사이드바 링크로 같은 라우트에 재진입해도 컴포넌트가 언마운트되지 않는 경우를 대비해,
  // 제출된 값(defaultValue)이 바뀌면 렌더 중 동기화한다(ClientCombobox와 동일 패턴).
  const [prevDefault, setPrevDefault] = useState(defaultValue);
  if (defaultValue !== prevDefault) {
    setPrevDefault(defaultValue);
    setValue(defaultValue);
    setOpen(false);
  }

  const current = options.find((o) => o.value === value);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function select(v: string) {
    setValue(v);
    setOpen(false);
  }

  function toggleOpen() {
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        const idx = options.findIndex((o) => o.value === value);
        setHighlight(idx >= 0 ? idx : 0);
      }
      return next;
    });
  }

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <input type="hidden" name={name} value={value} />
      <button
        type="button"
        onClick={toggleOpen}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setHighlight((h) => Math.min(h + 1, options.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            if (open) {
              e.preventDefault();
              select(options[highlight].value);
            }
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2 text-center text-sm"
      >
        <span>{current?.label ?? ""}</span>
        <span aria-hidden>⌄</span>
      </button>
      <FloatingList anchorRef={boxRef} open={open}>
        <ul role="listbox" className="max-h-60 w-full overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
          {options.map((o, i) => (
            <li key={o.value}>
              <button
                type="button"
                role="option"
                aria-selected={o.value === value}
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(o.value);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`block w-full px-2 py-2 text-center text-sm ${
                  o.value === value
                    ? "bg-[var(--color-primary)] text-white"
                    : i === highlight
                      ? "bg-[var(--color-hover)]"
                      : ""
                }`}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      </FloatingList>
    </div>
  );
}
