"use client";

import { useActionState, useEffect, useState } from "react";
import { createTaskAction, updateTaskAction, deleteTaskAction } from "../actions";
import { OK, type ActionState } from "@/lib/action-state";
import { digitsOnly, formatThousandsSigned, signedDigitsOnly } from "@/lib/format";

type Task = {
  id: string;
  name: string;
  unitPrice: number;
  contractCount: number | null;
  contractAmount: number | null;
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
// 서버 액션에는 계산된 과업명(name) 하나만 hidden 필드로 전송한다.
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
  const submittedName = category === ETC ? etcName : category;
  return (
    <div className={labelCls}>
      과업명(분류 선택)
      <input type="hidden" name="name" value={submittedName} />
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2">
        {TASK_CATEGORIES.map((c) => (
          <label key={c} className="flex items-center gap-1.5 text-sm">
            {/* 9개 중 하나만 선택되도록 클릭 시 다른 선택을 대체한다(단일 선택). */}
            <input type="checkbox" checked={category === c} onChange={() => setCategory(c)} />
            {c}
          </label>
        ))}
      </div>
      {/* "기타"를 선택했을 때만 과업명을 자유롭게 입력할 수 있다. */}
      {category === ETC && (
        <input
          required
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

function StatusMessage({ state }: { state: ActionState }) {
  if (state.ok && state.message) return <span className="text-sm text-[var(--color-primary)]">{state.message}</span>;
  if (!state.ok && state.error) return <span className="text-sm text-[var(--color-danger)]">{state.error}</span>;
  return null;
}

function NewTaskForm({ clientId }: { clientId: string }) {
  const [state, formAction] = useActionState(createTaskAction, OK);
  const [category, setCategory] = useState("");
  const [etcName, setEtcName] = useState("");
  const [unit, setUnit] = useState("");
  const [count, setCount] = useState("");
  // 계약금은 단가/횟수 입력 시 자동 채워지되, 직접 수정도 가능하다(수정 후 단가·횟수를 바꾸면 다시 자동값).
  const [amount, setAmount] = useState("");

  useEffect(() => {
    if (state.ok && state.message) {
      setCategory("");
      setEtcName("");
      setUnit("");
      setCount("");
      setAmount("");
    }
  }, [state]);

  return (
    <form action={formAction} className={cardCls}>
      <input type="hidden" name="clientId" value={clientId} />
      <CategoryPicker category={category} setCategory={setCategory} etcName={etcName} setEtcName={setEtcName} />
      <label className={labelCls}>
        단가(원)
        <input
          name="unitPrice" inputMode="numeric" required value={unit}
          onChange={(e) => {
            const u = formatThousandsSigned(e.target.value);
            setUnit(u);
            setAmount(autoAmountStr(u, count));
          }}
          className={`${inputCls} w-40 text-right`}
        />
      </label>
      <label className={labelCls}>
        횟수
        <input
          name="contractCount" inputMode="numeric" value={count}
          onChange={(e) => {
            const c = digitsOnly(e.target.value);
            setCount(c);
            setAmount(autoAmountStr(unit, c));
          }}
          className={`${inputCls} w-28 text-right`}
        />
      </label>
      <label className={labelCls}>
        계약금(자동·수정가능)
        <input
          name="contractAmount" inputMode="numeric" value={amount}
          onChange={(e) => setAmount(formatThousandsSigned(e.target.value))}
          className={`${inputCls} w-44 text-right`}
        />
      </label>
      <button type="submit" className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white">과업 추가</button>
      <StatusMessage state={state} />
    </form>
  );
}

function EditTaskRow({ clientId, task }: { clientId: string; task: Task }) {
  const [state, formAction] = useActionState(updateTaskAction, OK);
  const [delState, delAction] = useActionState(deleteTaskAction, OK);
  // 저장된 과업명을 분류 선택 + (기타)자유입력으로 분해해 초기값으로 쓴다.
  const initial = splitName(task.name);
  const [category, setCategory] = useState(initial.category);
  const [etcName, setEtcName] = useState(initial.etcName);
  const [unit, setUnit] = useState(formatThousandsSigned(task.unitPrice));
  const [count, setCount] = useState(task.contractCount != null ? String(task.contractCount) : "");
  // 저장된 계약금을 초기값으로. 이후 단가/횟수를 바꾸면 자동값으로 다시 채워진다.
  const [amount, setAmount] = useState(task.contractAmount != null ? formatThousandsSigned(task.contractAmount) : "");

  return (
    <div className={cardCls}>
      <form action={formAction} className="flex flex-wrap items-end gap-4">
        <input type="hidden" name="id" value={task.id} />
        <input type="hidden" name="clientId" value={clientId} />
        <CategoryPicker category={category} setCategory={setCategory} etcName={etcName} setEtcName={setEtcName} />
        <label className={labelCls}>
          단가(원)
          <input
            name="unitPrice" inputMode="numeric" required value={unit}
            onChange={(e) => {
              const u = formatThousandsSigned(e.target.value);
              setUnit(u);
              setAmount(autoAmountStr(u, count));
            }}
            className={`${inputCls} w-40 text-right`}
          />
        </label>
        <label className={labelCls}>
          횟수
          <input
            name="contractCount" inputMode="numeric" value={count}
            onChange={(e) => {
              const c = digitsOnly(e.target.value);
              setCount(c);
              setAmount(autoAmountStr(unit, c));
            }}
            className={`${inputCls} w-28 text-right`}
          />
        </label>
        <label className={labelCls}>
          계약금(자동·수정가능)
          <input
            name="contractAmount" inputMode="numeric" value={amount}
            onChange={(e) => setAmount(formatThousandsSigned(e.target.value))}
            className={`${inputCls} w-44 text-right`}
          />
        </label>
        <button type="submit" className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white">저장</button>
        <StatusMessage state={state} />
      </form>
      <form action={delAction} className="flex items-end gap-2">
        <input type="hidden" name="id" value={task.id} />
        <input type="hidden" name="clientId" value={clientId} />
        <button type="submit" className="rounded border border-[var(--color-border)] px-3 py-2 text-sm">삭제</button>
        <StatusMessage state={delState} />
      </form>
    </div>
  );
}

export function TaskManager({ clientId, tasks }: { clientId: string; tasks: Task[] }) {
  return (
    <div>
      <NewTaskForm clientId={clientId} />
      {tasks.length === 0 ? (
        <p className="text-[var(--color-muted)]">등록된 과업이 없습니다.</p>
      ) : (
        tasks.map((t) => <EditTaskRow key={t.id} clientId={clientId} task={t} />)
      )}
    </div>
  );
}
