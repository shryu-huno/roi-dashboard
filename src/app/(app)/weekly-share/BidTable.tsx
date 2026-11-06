"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveBidAction } from "./bids-actions";
import {
  BID_KIND_LABEL, BID_KINDS, BID_STATUS_LABEL, BID_STATUSES, ddayBadge, formatBidDate,
  type BidKind, type BidStatus, type BidView,
} from "@/lib/bids";
import { formatThousands } from "@/lib/format";

type Draft = { orgName: string; title: string; kind: BidKind; amount: string; dueDate: string; announceDate: string; status: BidStatus; note: string };

const thCls = "px-3 py-3 text-center text-sm font-bold text-[var(--color-muted)]";
const tdCls = "px-3 py-3 text-center align-middle break-words";
const inputCls =
  "h-[38px] w-full rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm outline-none focus:border-[var(--color-primary)]";
const WIDTHS = [9, 25, 7, 13, 13, 13, 14, 6]; // 상태 · 발주처·사업명 · 구분 · 입찰 금액 · 제출 마감 · 결과 발표 · 비고 · (수정)

// 상태 배지: 색만으로 구분하지 않도록 글자(상태 이름)가 함께 들어 있다.
const CHIP: Record<BidStatus, string> = {
  PREPARING: "bg-blue-50 text-blue-700",
  REVIEWING: "bg-amber-50 text-amber-700",
  WON: "bg-emerald-50 text-emerald-700",
  LOST: "bg-red-50 text-red-700",
  FAILED: "bg-slate-100 text-slate-500",
};

const emptyDraft = (): Draft => ({ orgName: "", title: "", kind: "NEW", amount: "", dueDate: "", announceDate: "", status: "PREPARING", note: "" });
const toDraft = (b: BidView): Draft => ({
  orgName: b.orgName, title: b.title, kind: b.kind, amount: formatThousands(b.amount), dueDate: b.dueDate,
  announceDate: b.announceDate, status: b.status, note: b.note,
});

export function BidTable({
  bids, today, summary,
}: {
  bids: BidView[]; // 정렬된 목록
  today: string;
  summary: { count: number; amount: number };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function open(b: BidView | null) {
    setDraft(b ? toDraft(b) : emptyDraft());
    setError(null);
    setEditing({ id: b?.id ?? null });
  }

  function save() {
    if (!editing) return;
    startTransition(async () => {
      setError(null);
      const out = await saveBidAction(draft, editing.id);
      if (!out.ok) {
        setError(out.error);
        return;
      }
      setToast(editing.id ? `${draft.orgName.trim()} 입찰 정보를 저장했어요` : `${draft.orgName.trim()} 입찰을 등록했어요`);
      setTimeout(() => setToast(null), 3000);
      setEditing(null);
      router.refresh();
    });
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3 text-sm text-[var(--color-muted)]">
        <span>
          <b className="text-[var(--color-fg)]">{summary.count}</b>건 · 입찰 금액 합계 <b className="text-[var(--color-fg)]">{summary.amount.toLocaleString("ko-KR")}</b>원
        </span>
        <button type="button" onClick={() => open(null)} className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white">
          + 입찰 등록
        </button>
      </div>

      <div className="overflow-x-auto rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <table className="w-full min-w-[980px] table-fixed text-sm">
          <colgroup>
            {WIDTHS.map((w, i) => (
              <col key={i} style={{ width: `${w}%` }} />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <th className={thCls}>상태</th>
              <th className={thCls}>발주처 · 사업명</th>
              <th className={thCls}>구분</th>
              <th className={thCls}>입찰 금액</th>
              <th className={thCls}>제출 마감</th>
              <th className={thCls}>결과 발표</th>
              <th className={thCls}>비고</th>
              <th className={thCls}></th>
            </tr>
          </thead>
          <tbody>
            {bids.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-[var(--color-muted)]">조건에 맞는 입찰이 없어요.</td>
              </tr>
            ) : (
              bids.map((b) => {
                const dday = ddayBadge(b, today);
                return (
                  <tr key={b.id} className="border-b border-[var(--color-border)] last:border-b-0">
                    <td className={tdCls}>
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${CHIP[b.status]}`}>{BID_STATUS_LABEL[b.status]}</span>
                    </td>
                    <td className={tdCls}>
                      <b className="block font-semibold">{b.orgName}</b>
                      <span className="text-xs text-[var(--color-muted)]">{b.title}</span>
                    </td>
                    <td className={tdCls}>
                      <span className="rounded bg-[var(--color-bg)] px-2 py-0.5 text-xs font-semibold text-[var(--color-muted)]">{BID_KIND_LABEL[b.kind]}</span>
                    </td>
                    <td className={`${tdCls} tabular-nums`}>{b.amount.toLocaleString("ko-KR")}</td>
                    <td className={`${tdCls} tabular-nums`}>
                      {formatBidDate(b.dueDate)}
                      {b.status === "PREPARING" && dday && <DayBadge {...dday} />}
                    </td>
                    <td className={`${tdCls} tabular-nums`}>
                      {formatBidDate(b.announceDate)}
                      {b.status === "REVIEWING" && dday && <DayBadge {...dday} />}
                    </td>
                    <td className={`${tdCls} text-xs text-[var(--color-muted)]`}>{b.note || "—"}</td>
                    <td className={tdCls}>
                      <button type="button" onClick={() => open(b)} className="text-sm font-medium text-[var(--color-primary)]">수정</button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !pending) setEditing(null);
          }}
        >
          <div role="dialog" aria-modal="true" aria-label={editing.id ? "입찰 정보 수정" : "입찰 등록"} className="flex max-h-full w-[min(640px,100%)] flex-col gap-3 overflow-y-auto rounded-[14px] bg-[var(--color-surface)] p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">{editing.id ? "입찰 정보 수정" : "입찰 등록"}</h2>
              <button type="button" disabled={pending} onClick={() => setEditing(null)} className="text-sm font-medium text-[var(--color-primary)]">닫기</button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">
                발주처
                <input className={inputCls} value={draft.orgName} placeholder="예: 세움도시공사" onChange={(e) => set("orgName", e.target.value)} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">
                구분
                <select className={inputCls} value={draft.kind} onChange={(e) => set("kind", e.target.value as BidKind)}>
                  {BID_KINDS.map((k) => (
                    <option key={k} value={k}>{BID_KIND_LABEL[k]}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)] sm:col-span-2">
                사업명
                <input className={inputCls} value={draft.title} placeholder="예: 2027년 임직원 심리상담(EAP) 운영 용역" onChange={(e) => set("title", e.target.value)} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">
                입찰 금액 (원)
                <input className={`${inputCls} tabular-nums`} inputMode="numeric" value={draft.amount} placeholder="0" onChange={(e) => set("amount", formatThousands(e.target.value))} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">
                상태
                <select className={inputCls} value={draft.status} onChange={(e) => set("status", e.target.value as BidStatus)}>
                  {BID_STATUSES.map((s) => (
                    <option key={s} value={s}>{BID_STATUS_LABEL[s]}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">
                제출 마감일
                <input type="date" className={inputCls} value={draft.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">
                결과 발표일 <span className="text-[11px]">(비우면 제출 마감일과 같게)</span>
                <input type="date" className={inputCls} value={draft.announceDate} onChange={(e) => set("announceDate", e.target.value)} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)] sm:col-span-2">
                비고
                <input className={inputCls} value={draft.note} placeholder="결과 사유, 계약 예정일 등" onChange={(e) => set("note", e.target.value)} />
              </label>
            </div>
            {error && <p role="alert" className="text-sm font-medium text-[var(--color-danger)]">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" disabled={pending} onClick={() => setEditing(null)} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">취소</button>
              <button type="button" disabled={pending} onClick={save} className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
                {pending ? "저장 중…" : editing.id ? "저장" : "등록"}
              </button>
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-[10px] bg-[var(--color-fg)] px-4 py-2 text-sm text-white">{toast}</div>
      )}
    </div>
  );
}

function DayBadge({ label, urgent }: { label: string; urgent: boolean }) {
  return (
    <span className={`ml-1.5 inline-block rounded px-1.5 py-0.5 text-[11px] font-bold ${urgent ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{label}</span>
  );
}
