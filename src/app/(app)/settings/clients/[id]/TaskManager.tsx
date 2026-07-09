"use client";

import { useActionState, useEffect, useState } from "react";
import { createTaskAction, updateTaskAction, deleteTaskAction } from "../actions";
import { OK, type ActionState } from "@/lib/action-state";
import { digitsOnly, formatThousands } from "@/lib/format";

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

function contractAmountOf(unit: string, count: string): number {
  const u = Number(digitsOnly(unit));
  const c = Number(digitsOnly(count));
  return u * c;
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

  useEffect(() => {
    if (state.ok && state.message) {
      setName("");
      setUnit("");
      setCount("");
    }
  }, [state]);

  const amount = contractAmountOf(unit, count);

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
          onChange={(e) => setUnit(formatThousands(e.target.value))}
          className={`${inputCls} w-40 text-right`}
        />
      </label>
      <label className={labelCls}>
        횟수
        <input
          name="contractCount" inputMode="numeric" value={count}
          onChange={(e) => setCount(digitsOnly(e.target.value))}
          className={`${inputCls} w-28 text-right`}
        />
      </label>
      <div className={labelCls}>
        계약금(자동)
        <div className={`${inputCls} w-44 bg-[var(--color-bg)] text-right`}>
          {amount ? amount.toLocaleString("ko-KR") : "—"}
        </div>
      </div>
      <button type="submit" className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white">과업 추가</button>
      <StatusMessage state={state} />
    </form>
  );
}

function EditTaskRow({ clientId, task }: { clientId: string; task: Task }) {
  const [state, formAction] = useActionState(updateTaskAction, OK);
  const [delState, delAction] = useActionState(deleteTaskAction, OK);
  const [name, setName] = useState(task.name);
  const [unit, setUnit] = useState(formatThousands(task.unitPrice));
  const [count, setCount] = useState(task.contractCount != null ? String(task.contractCount) : "");

  const amount = contractAmountOf(unit, count);

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
            onChange={(e) => setUnit(formatThousands(e.target.value))}
            className={`${inputCls} w-40 text-right`}
          />
        </label>
        <label className={labelCls}>
          횟수
          <input
            name="contractCount" inputMode="numeric" value={count}
            onChange={(e) => setCount(digitsOnly(e.target.value))}
            className={`${inputCls} w-28 text-right`}
          />
        </label>
        <div className={labelCls}>
          계약금(자동)
          <div className={`${inputCls} w-44 bg-[var(--color-bg)] text-right`}>
            {amount ? amount.toLocaleString("ko-KR") : "—"}
          </div>
        </div>
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
