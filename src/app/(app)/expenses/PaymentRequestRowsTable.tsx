"use client";

import { useEffect, useRef, useState } from "react";
import type { TaxType } from "@prisma/client";
import type { PayeeOption } from "@/lib/data/payees";
import { PayeeCombobox } from "@/components/PayeeCombobox";
import { PaymentRequestClientCombobox } from "@/components/PaymentRequestClientCombobox";
import { FloatingList } from "@/components/FloatingList";
import { PAYMENT_REQUEST_ENTITY_LABELS, PAYMENT_REQUEST_ENTITY_BY_LABEL } from "@/lib/labels";
import { formatThousands, formatWon } from "@/lib/format";
import type { PaymentRequestRowField } from "@/lib/payment-request-validation";

export type DraftRow = {
  key: string;
  entity: "HUNO" | "HUNO_INC" | "";
  clientId: string;
  payeeId: string | null;
  bizName: string;
  unitPrice: string;
  transportFee: string;
  materialFee: string;
  count: string;
  taxType: TaxType | "";
  memo: string;
};

export function newDraftRow(): DraftRow {
  return {
    key: crypto.randomUUID(),
    entity: "", clientId: "", payeeId: null, bizName: "",
    unitPrice: "", transportFee: "", materialFee: "", count: "",
    taxType: "", memo: "",
  };
}

export function computeRowAmount(row: DraftRow): number {
  const unitPrice = Number(row.unitPrice) || 0;
  const transportFee = Number(row.transportFee) || 0;
  const materialFee = Number(row.materialFee) || 0;
  const count = Number(row.count) || 0;
  return (unitPrice + transportFee + materialFee) * count;
}

// businessType("휴노"/"휴노INC")을 지급명의 enum으로. 그 외 값/미설정은 매핑하지 않는다.
function inferEntity(businessType: string | null): "HUNO" | "HUNO_INC" | "" {
  if (businessType === "휴노") return "HUNO";
  if (businessType === "휴노INC") return "HUNO_INC";
  return "";
}

const cellCls = "whitespace-nowrap px-2 py-2 text-center align-middle";

function inputCls(hasError = false): string {
  const border = hasError ? "border-[var(--color-danger)]" : "border-[var(--color-border)]";
  return `w-full rounded border ${border} px-2 py-1.5 text-center text-sm`;
}

export function PaymentRequestRowsTable({
  rows,
  onRowsChange,
  clients,
  payees,
  rowErrors = new Map(),
}: {
  rows: DraftRow[];
  onRowsChange: (rows: DraftRow[]) => void;
  clients: { id: string; name: string; businessType: string | null }[];
  payees: PayeeOption[];
  rowErrors?: Map<string, Set<PaymentRequestRowField>>;
}) {
  // 체크박스 선택은 이 컴포넌트가 소유하는 실제 상태(useState)로 관리한다 — 렌더마다 새로
  // 만들어지는 일반 객체(ref 흉내)를 쓰면 다른 행 입력으로 리렌더될 때 선택이 조용히 사라진다.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function updateRow(key: string, patch: Partial<DraftRow>) {
    onRowsChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function handleClientChange(key: string, clientId: string) {
    const row = rows.find((r) => r.key === key)!;
    const client = clients.find((c) => c.id === clientId);
    const patch: Partial<DraftRow> = { clientId };
    // 지급명의를 아직 고르지 않았을 때만 고객사의 businessType으로 기본값을 채운다(덮어쓰지 않음).
    if (row.entity === "" && client) {
      const inferred = inferEntity(client.businessType);
      if (inferred) patch.entity = inferred;
    }
    updateRow(key, patch);
  }

  const allSelected = rows.length > 0 && selected.size === rows.length;

  function toggleSelect(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.key)));
  }

  function removeSelected() {
    if (selected.size === 0) return;
    onRowsChange(rows.filter((r) => !selected.has(r.key)));
    setSelected(new Set());
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-center text-[var(--color-muted)]">
              <th className="w-10 px-2 py-2">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} aria-label="전체선택" />
              </th>
              <th className="w-24 px-2 py-2">지급명의</th>
              <th className="w-40 px-2 py-2">고객사</th>
              <th className="w-40 px-2 py-2">사업자명(이름)</th>
              <th className="w-28 px-2 py-2">단가</th>
              <th className="w-24 px-2 py-2">교통비</th>
              <th className="w-24 px-2 py-2">재료비</th>
              <th className="w-14 px-2 py-2">횟수</th>
              <th className="w-24 px-2 py-2">지급액</th>
              <th className="px-2 py-2">상세내역</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <RowFields
                key={row.key}
                row={row}
                no={i + 1}
                selected={selected.has(row.key)}
                onToggleSelect={() => toggleSelect(row.key)}
                onChange={(patch) => updateRow(row.key, patch)}
                onClientChange={(clientId) => handleClientChange(row.key, clientId)}
                clients={clients}
                payees={payees}
                errors={rowErrors.get(row.key)}
              />
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => onRowsChange([...rows, newDraftRow()])} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">+ 행 추가</button>
        <button type="button" onClick={removeSelected} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">- 행 삭제</button>
      </div>
    </div>
  );
}

function RowFields({
  row, no, selected, onToggleSelect, onChange, onClientChange, clients, payees, errors,
}: {
  row: DraftRow;
  no: number;
  selected: boolean;
  onToggleSelect: () => void;
  onChange: (patch: Partial<DraftRow>) => void;
  onClientChange: (clientId: string) => void;
  clients: { id: string; name: string; businessType: string | null }[];
  payees: PayeeOption[];
  errors?: Set<PaymentRequestRowField>;
}) {
  return (
    <tr className="border-b border-[var(--color-border)]">
      <td className={cellCls}><input type="checkbox" checked={selected} onChange={onToggleSelect} aria-label={`${no}행 선택`} /></td>
      <td className={cellCls}>
        <EntitySelect
          value={row.entity}
          onChange={(entity) => onChange({ entity })}
          hasError={errors?.has("entity")}
        />
      </td>
      <td className={cellCls}>
        <PaymentRequestClientCombobox
          clients={clients}
          selectedId={row.clientId || null}
          onSelect={(c) => onClientChange(c?.id ?? "")}
          hasError={errors?.has("clientId")}
        />
      </td>
      <td className={`${cellCls} min-w-[10rem]`}>
        <PayeeCombobox
          payees={payees}
          selectedId={row.payeeId}
          onSelect={(p) => onChange({ payeeId: p?.id ?? null, bizName: p?.bizName ?? "", taxType: p?.taxType ?? "" })}
          hasError={errors?.has("payeeId")}
        />
      </td>
      <td className={cellCls}><input type="text" inputMode="numeric" value={formatThousands(row.unitPrice)} onChange={(e) => onChange({ unitPrice: e.target.value.replace(/[^\d]/g, "") })} className={inputCls(errors?.has("unitPrice"))} /></td>
      <td className={cellCls}><input type="text" inputMode="numeric" value={formatThousands(row.transportFee)} onChange={(e) => onChange({ transportFee: e.target.value.replace(/[^\d]/g, "") })} className={inputCls()} /></td>
      <td className={cellCls}><input type="text" inputMode="numeric" value={formatThousands(row.materialFee)} onChange={(e) => onChange({ materialFee: e.target.value.replace(/[^\d]/g, "") })} className={inputCls()} /></td>
      <td className={cellCls}><input type="text" inputMode="numeric" value={row.count} onChange={(e) => onChange({ count: e.target.value.replace(/[^\d]/g, "") })} className={inputCls(errors?.has("count"))} /></td>
      <td className={`${cellCls} font-medium`}>{formatWon(computeRowAmount(row))}</td>
      <td className={`${cellCls} min-w-[10rem]`}>
        <input type="text" value={row.memo} onChange={(e) => onChange({ memo: e.target.value })} className={inputCls()} />
      </td>
    </tr>
  );
}

// 네이티브 <select>는 펼친 목록을 OS가 그려 CSS로 가운데 정렬을 할 수 없어 커스텀 드롭다운으로 대체.
function EntitySelect({
  value,
  onChange,
  hasError,
}: {
  value: DraftRow["entity"];
  onChange: (value: DraftRow["entity"]) => void;
  hasError?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const options: { value: DraftRow["entity"]; label: string }[] = [
    { value: "", label: "선택" },
    ...PAYMENT_REQUEST_ENTITY_LABELS.map((label) => ({ value: PAYMENT_REQUEST_ENTITY_BY_LABEL[label], label })),
  ];
  const currentLabel = options.find((o) => o.value === value)?.label ?? "선택";

  return (
    <div ref={boxRef} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className={inputCls(hasError)}>
        {currentLabel}
      </button>
      <FloatingList anchorRef={boxRef} open={open}>
        <ul className="mt-1 w-full overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
          {options.map((o) => (
            <li key={o.value || "none"}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`block w-full px-2 py-1.5 text-center text-sm hover:bg-[var(--color-border)] ${
                  o.value === value ? "bg-[var(--color-border)]" : ""
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
