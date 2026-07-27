"use client";

import { useRef, useState } from "react";

// 재사용 드래그 앤 드롭 파일 선택기. 내부 hidden input이 폼 필드(name)이며,
// 드롭 시 input.files에 반영해 네이티브 폼 제출과 호환된다.
type Props = {
  name: string;
  accept: string;
  hint?: string;
  label?: string;
  onFileName?: (name: string | null) => void;
};

export function FileDropzone({ name, accept, hint, label = "엑셀 파일을 이곳에 드래그 앤 드롭 하세요", onFileName }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  function update(files: FileList | null) {
    const f = files && files.length ? files[0] : null;
    setFileName(f ? f.name : null);
    onFileName?.(f ? f.name : null);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const files = e.dataTransfer.files;
    if (inputRef.current && files.length) {
      inputRef.current.files = files; // 폼 제출 소스로 반영
      update(files);
    }
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`flex flex-col items-center justify-center gap-2 rounded-[14px] border-2 border-dashed px-6 py-10 text-center ${
        dragging ? "border-[var(--color-primary)] bg-[var(--color-hover)]" : "border-[var(--color-border)]"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        name={name}
        accept={accept}
        className="hidden"
        onChange={(e) => update(e.target.files)}
      />
      <div className="text-3xl" aria-hidden>☁️</div>
      <p className="text-sm font-medium">{label}</p>
      {hint && <p className="text-xs text-[var(--color-muted)]">{hint}</p>}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="mt-1 rounded border border-[var(--color-border)] px-4 py-2 text-sm"
      >
        📁 파일 선택
      </button>
      {fileName && <p className="mt-1 text-xs text-[var(--color-primary)]">{fileName}</p>}
    </div>
  );
}
