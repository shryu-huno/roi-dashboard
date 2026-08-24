"use client";

import { useRef, useState } from "react";
import { digitsOnly, formatThousandsSigned, signedDigitsOnly } from "@/lib/format";

type Task = {
  id: string;
  name: string;
  unitPrice: number;
  contractCount: number | null;
  contractAmount: number | null;
  vatExempt?: boolean;
};

const labelCls = "flex flex-col text-xs text-[var(--color-muted)]";
const inputCls = "mt-1 rounded border border-[var(--color-border)] px-3 py-2 text-sm";
const cardCls =
  "mb-3 flex flex-wrap items-end gap-4 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5";

// 과업 분류 9종. 8개는 라벨 고정, "기타"만 과업명을 자유 입력한다.
// 선택한 값이 그대로 과업명(name)으로 저장된다(설계 문서 §3.3 규칙).
const TASK_CATEGORIES = [
  "전문가 상담",
  "프로그램(강의형)",
  "프로그램(체험형)",
  "프로그램(1:1코칭)",
  "심리진단",
  "긴급심리지원",
  "홍보 관리",
  "운영 관리",
  "기타",
] as const;
const ETC = "기타";

// 저장된 과업명을 초기 선택 상태로 되돌린다.
// 8개 고정 라벨과 정확히 일치하면 그 분류를 선택, 아니면 "기타"로 두고 이름을 자유입력값으로 채운다.
function splitName(name: string): { category: string; etcName: string } {
  const isFixed = (TASK_CATEGORIES as readonly string[]).includes(name) && name !== ETC;
  return isFixed ? { category: name, etcName: "" } : { category: ETC, etcName: name };
}

// 과업 분류 선택기: 9개 중 하나만 체크할 수 있고, "기타"일 때만 자유 입력창이 열린다.
function CategoryPicker({
  category,
  setCategory,
  etcName,
  setEtcName,
}: {
  category: string;
  setCategory: (v: string) => void;
  etcName: string;
  setEtcName: (v: string) => void;
}) {
  return (
    <div className={`${labelCls} w-full`}>
      과업명(분류 선택)
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2">
        {TASK_CATEGORIES.map((c) => (
          <label key={c} className="flex items-center gap-1.5 whitespace-nowrap text-sm">
            {/* 9개 중 하나만 선택되도록 클릭 시 다른 선택을 대체한다(단일 선택). */}
            <input type="checkbox" checked={category === c} onChange={() => setCategory(c)} />
            {c}
          </label>
        ))}
      </div>
      {/* "기타"를 선택했을 때만 과업명을 자유롭게 입력할 수 있다. */}
      {category === ETC && (
        <input
          value={etcName}
          onChange={(e) => setEtcName(e.target.value)}
          placeholder="과업명 직접 입력"
          className={`${inputCls} w-56`}
        />
      )}
    </div>
  );
}

// 단가×횟수 자동 계약금(콤마 문자열). 횟수 미입력이면 빈 문자열(=계약금 없음).
function autoAmountStr(unit: string, count: string): string {
  const c = digitsOnly(count);
  if (c === "") return "";
  const u = Number(signedDigitsOnly(unit));
  return formatThousandsSigned(String(u * Number(c)));
}

type Row = {
  key: string; // React 키(신규 행은 순번 기반, 기존 행은 id 기반).
  id?: string; // 기존 과업 id. 없으면 신규.
  category: string;
  etcName: string;
  unit: string;
  count: string;
  amount: string;
  vatExempt: boolean; // 면세 여부(체크 시 부가세 토글 무시).
  deleted: boolean; // 기존 과업을 삭제 표시(프로젝트 저장 시 반영).
};

function toRow(t: Task): Row {
  const { category, etcName } = splitName(t.name);
  return {
    key: `t-${t.id}`,
    id: t.id,
    category,
    etcName,
    unit: formatThousandsSigned(t.unitPrice),
    count: t.contractCount != null ? String(t.contractCount) : "",
    amount: t.contractAmount != null ? formatThousandsSigned(t.contractAmount) : "",
    vatExempt: t.vatExempt ?? false,
    deleted: false,
  };
}

// 서버로 보낼 과업명: 8개 고정 분류면 그 값, "기타"면 자유입력값.
function submittedName(r: Row): string {
  return r.category === ETC ? r.etcName : r.category;
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

// 과업 관리자. 과업 추가/수정/삭제 표시는 모두 클라이언트 상태에 모았다가,
// 상단 "프로젝트 저장" 폼(formId)에 hidden JSON 한 필드로 실어 한 번에 저장한다.
// 삭제는 각 행의 "×"로 표시(되돌리기 가능)하고 프로젝트 저장 시 확정된다.
export function TaskManager({ tasks, formId }: { tasks: Task[]; formId: string }) {
  const [rows, setRows] = useState<Row[]>(() => tasks.map(toRow));
  const seq = useRef(0);

  const setField = (key: string, field: "category" | "etcName" | "unit" | "count" | "amount", value: string) =>
    setRows((rs) =>
      rs.map((r) => {
        if (r.key !== key) return r;
        const next = { ...r };
        if (field === "unit") {
          next.unit = formatThousandsSigned(value);
          next.amount = autoAmountStr(next.unit, r.count); // 단가 변경 시 계약금 자동 재계산.
        } else if (field === "count") {
          next.count = digitsOnly(value);
          next.amount = autoAmountStr(r.unit, next.count);
        } else if (field === "amount") {
          next.amount = formatThousandsSigned(value); // 계약금 직접 수정.
        } else {
          next[field] = value;
        }
        return next;
      }),
    );

  // 면세 체크박스 전용 setter(boolean이라 setField의 문자열 경유를 피한다).
  const setExempt = (key: string, v: boolean) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, vatExempt: v } : r)));

  const addRow = () =>
    setRows((rs) => [
      ...rs,
      { key: `new-${seq.current++}`, category: "", etcName: "", unit: "", count: "", amount: "", vatExempt: false, deleted: false },
    ]);

  // 신규 행은 완전히 제거, 기존 행은 삭제 표시(프로젝트 저장 시 실제 삭제).
  const removeRow = (r: Row) =>
    setRows((rs) => (r.id ? rs.map((x) => (x.key === r.key ? { ...x, deleted: true } : x)) : rs.filter((x) => x.key !== r.key)));

  const restoreRow = (key: string) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, deleted: false } : r)));

  // 프로젝트 폼에 실어 보낼 과업 목록. 아직 분류를 안 고른 빈 신규 행은 제외한다.
  const payload = rows
    .filter((r) => r.id || (!r.deleted && submittedName(r) !== ""))
    .map((r) => ({
      ...(r.id ? { id: r.id } : {}),
      name: submittedName(r),
      unitPrice: r.unit,
      contractCount: r.count,
      contractAmount: r.amount,
      vatExempt: r.vatExempt,
      ...(r.deleted ? { deleted: true } : {}),
    }));

  return (
    <div>
      {/* 과업 전체를 프로젝트 저장 폼에 JSON 한 필드로 전달(form 속성으로 상단 폼에 연결). */}
      <input type="hidden" name="tasks" form={formId} value={JSON.stringify(payload)} readOnly />

      {rows.map((r) => (
        <div key={r.key} className={`${cardCls} ${r.deleted ? "opacity-60" : ""}`}>
          <fieldset disabled={r.deleted} className="contents">
            <CategoryPicker
              category={r.category}
              setCategory={(v) => setField(r.key, "category", v)}
              etcName={r.etcName}
              setEtcName={(v) => setField(r.key, "etcName", v)}
            />
            <label className={labelCls}>
              단가(원)
              <input
                inputMode="numeric"
                value={r.unit}
                onChange={(e) => setField(r.key, "unit", e.target.value)}
                className={`${inputCls} w-40 text-right`}
              />
            </label>
            <label className={labelCls}>
              횟수
              <input
                inputMode="numeric"
                value={r.count}
                onChange={(e) => setField(r.key, "count", e.target.value)}
                className={`${inputCls} w-28 text-right`}
              />
            </label>
            <label className={labelCls}>
              계약금(자동·수정가능)
              <input
                inputMode="numeric"
                value={r.amount}
                onChange={(e) => setField(r.key, "amount", e.target.value)}
                className={`${inputCls} w-44 text-right`}
              />
            </label>
            {/* 면세 과업(체크 시 부가세 토글이 켜져도 ×1.1 미적용). 대부분 과세라 기본 uncheck. */}
            <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium text-[#991B1B]">
              <input type="checkbox" checked={r.vatExempt} onChange={(e) => setExempt(r.key, e.target.checked)} />
              면세
            </label>
          </fieldset>
          {r.deleted ? (
            <div className="flex items-center gap-2 self-end pb-1">
              <span className="text-xs text-[var(--color-danger)]">삭제 예정</span>
              <button
                type="button"
                onClick={() => restoreRow(r.key)}
                className="rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-fg)]"
              >
                되돌리기
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => removeRow(r)}
              aria-label="과업 제거"
              title="과업 제거"
              className="inline-flex shrink-0 items-center justify-center self-end rounded-md p-2 text-[var(--color-muted)] hover:bg-[#F2ACB0] hover:text-[#A23B40]"
            >
              <CloseIcon />
            </button>
          )}
        </div>
      ))}

      <button
        type="button"
        onClick={addRow}
        className="shrink-0 whitespace-nowrap rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white"
      >
        과업 추가
      </button>
    </div>
  );
}
