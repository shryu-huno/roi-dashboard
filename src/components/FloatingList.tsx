"use client";

import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

type Rect = { top: number; left: number; width: number };

// 콤보박스/드롭다운 목록을 document.body로 포탈해 고정 위치로 그린다.
// overflow-x-auto인 표 조상 안에 있으면 CSS 스펙상 overflow-y도 auto로 취급되어
// 목록이 표 영역에 잘려 보이는 문제가 있어, 포탈로 그 조상을 벗어난다.
export function FloatingList({
  anchorRef,
  open,
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  children: React.ReactNode;
}) {
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    if (!open || !anchorRef.current) {
      setRect(null);
      return;
    }
    function update() {
      const r = anchorRef.current!.getBoundingClientRect();
      setRect({ top: r.bottom, left: r.left, width: r.width });
    }
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, anchorRef]);

  if (!open || !rect) return null;

  return createPortal(
    <div style={{ position: "fixed", top: rect.top, left: rect.left, width: rect.width }} className="z-50">
      {children}
    </div>,
    document.body,
  );
}
