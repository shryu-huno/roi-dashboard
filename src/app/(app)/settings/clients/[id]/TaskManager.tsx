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
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [count, setCount] = useState("");
  // 계약금은 단가/횟수 입력 시 자동 채워지되, 직접 수정도 가능하다(수정 후 단가·횟수를 바꾸면 다시 자동값).
  const [amount, setAmount] = useState("");

  useEffect(() => {
    if (state.ok && state.message) {
      setName("");
      setUnit("");
      setCount("");
      setAmount("");
    }
  }, [state]);

  return (
    <form action={formAction} className={cardCls}>
      <input type="hidden" name="clientId" value={clientId} />
      <label className={labelCls}>
        과업명
        <input name="name" required value={name} onChange={(e) => setName(e.target.value)} className={`${inputCls} w-56`} />
      </label>
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
  const [name, setName] = useState(task.name);
  const [unit, setUnit] = useState(formatThousandsSigned(task.unitPrice));
  const [count, setCount] = useState(task.contractCount != null ? String(task.contractCount) : "");
  // 저장된 계약금을 초기값으로. 이후 단가/횟수를 바꾸면 자동값으로 다시 채워진다.
  const [amount, setAmount] = useState(task.contractAmount != null ? formatThousandsSigned(task.contractAmount) : "");

  return (
    <div className={cardCls}>
      <form action={formAction} className="flex flex-wrap items-end gap-4">
        <input type="hidden" name="id" value={task.id} />
        <input type="hidden" name="clientId" value={clientId} />
        <label className={labelCls}>
          과업명
          <input name="name" required value={name} onChange={(e) => setName(e.target.value)} className={`${inputCls} w-56`} />
        </label>
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
