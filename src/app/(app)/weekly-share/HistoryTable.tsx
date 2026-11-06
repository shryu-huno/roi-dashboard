"use client";

import { Fragment, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { submitWeeklyAction } from "./actions";
import { describeShareStamp } from "@/lib/weekly-share-view";
import { historyText, type HistoryRow } from "@/lib/weekly-history";
import { ymValue } from "@/lib/month-range";
import { weekLabel, weekMonth, weekRange } from "@/lib/week";
import type { OtherWorkView, WeeklyShareView } from "@/lib/data/weekly-share";

type Draft = { thisWeek: string; nextWeek: string; note: string; noSpecial: boolean };

// 가운데 정렬. 열 폭은 colgroup으로 고정(table-fixed)해서 월별 표마다 같은 열이 같은 위치에 오게 한다.
const thCls = "px-3 py-3 text-center text-sm font-bold text-[var(--color-muted)]";
const tdCls = "px-3 py-3 text-center align-middle break-words";
const txtCls = `${tdCls} whitespace-pre-line leading-relaxed`;
const areaCls =
  "min-h-[84px] w-full min-w-0 resize-y rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm leading-relaxed outline-none focus:border-[var(--color-primary)] disabled:bg-[var(--color-bg)]";

// 열 폭(%). 고객사·PM 열 유무에 따라 합이 100이 되도록 세 가지 배치를 쓴다.
function columnWidths(grouped: boolean, single: boolean): number[] {
  if (grouped) return [9, 13, 9, 21, 21, 13, 14]; // PM · 고객사 · 주차 · 이번주 · 다음주 · 비고 · 작성
  if (single) return [10, 26, 26, 16, 22]; // 주차 · 이번주 · 다음주 · 비고 · 작성
  return [14, 10, 22, 22, 14, 18]; // 고객사 · 주차 · 이번주 · 다음주 · 비고 · 작성
}

function sectionsOf(rows: HistoryRow[], single: string | null): { title: string; rows: HistoryRow[] }[] {
  if (single) return [{ title: single, rows }];
  // 주의 소속 월(4일 이상 걸친 달)별로 나누고 최근 달부터. 같은 달 안의 순서(PM→고객사→주차)는 그대로 둔다.
  const map = new Map<number, { title: string; rows: HistoryRow[] }>();
  for (const r of rows) {
    const m = weekMonth(r.weekStart);
    const k = m.year * 12 + m.month;
    const e = map.get(k) ?? { title: `${m.year}년 ${m.month}월`, rows: [] };
    e.rows.push(r);
    map.set(k, e);
  }
  return [...map.entries()].sort((a, b) => b[0] - a[0]).map(([, v]) => v);
}

export function HistoryTable({
  rows, editableKeys, writer, grouped, single, section, scope, rangeLabel, counts,
}: {
  rows: HistoryRow[];
  editableKeys: string[];
  writer: boolean;
  grouped: boolean; // 관리자 보기: 파트·PM 구분
  single: boolean; // 고객사 하나만 보기
  section: string | null; // 월별 조회면 그 달 제목 한 구역, 아니면 null(주의 소속 월별 구역)
  scope: string;
  rangeLabel: string;
  counts: { shares: number; others: number; missing: number };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [overrides, setOverrides] = useState<Record<string, WeeklyShareView | OtherWorkView>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ thisWeek: "", nextWeek: "", note: "", noSpecial: false });
  const [msg, setMsg] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const editable = new Set(editableKeys);

  const view: HistoryRow[] = rows.map((r) => {
    const o = overrides[r.key];
    if (!o) return r;
    return r.kind === "client" ? { ...r, share: o as WeeklyShareView } : { ...r, other: o as OtherWorkView };
  });

  function startEdit(r: HistoryRow) {
    const src = r.kind === "client" ? r.share! : r.other;
    setDraft({ thisWeek: src.thisWeek, nextWeek: src.nextWeek, note: src.note, noSpecial: r.kind === "client" ? r.share!.noSpecial : false });
    setMsg(null);
    setEditing(r.key);
  }

  function save(r: HistoryRow) {
    startTransition(async () => {
      setMsg(null);
      const out = await submitWeeklyAction(
        r.kind === "client"
          ? { weekStart: r.weekStart, entries: [{ clientId: r.clientId, ...draft, version: r.share!.version }], other: null }
          : { weekStart: r.weekStart, entries: [], other: { tags: r.other.tags, thisWeek: draft.thisWeek, nextWeek: draft.nextWeek, note: draft.note } },
      );
      if (!out.ok) {
        setMsg(out.error);
        return;
      }
      const res = out.result;
      if (r.kind === "client") {
        const conflict = res.conflicts.find((c) => c.clientId === r.clientId);
        if (conflict) {
          setMsg(`${conflict.updatedByName ?? "다른 PM"}이(가) 방금 수정했어요. 최신 내용으로 바꿨으니 확인한 뒤 다시 수정해 주세요.`);
          setEditing(null);
          router.refresh();
          return;
        }
        if (res.rejected.length) {
          setMsg("이미 제출한 내용을 모두 비울 수는 없어요. 내용을 입력하거나 '특이사항 없음'을 선택해 주세요.");
          return;
        }
        const cur = res.current[r.clientId];
        if (cur) setOverrides((o) => ({ ...o, [r.key]: cur }));
      } else {
        if (res.other === "rejected") {
          setMsg("이미 제출한 기타 업무를 모두 비울 수는 없어요. 내용을 입력해 주세요.");
          return;
        }
        if (res.otherCurrent) setOverrides((o) => ({ ...o, [r.key]: res.otherCurrent! }));
      }
      setEditing(null);
      router.refresh();
    });
  }

  const text = historyText(view, { scope, rangeLabel, grouped, single, section: section ?? undefined });
  const copyable = view.some((r) => r.kind === "other" || r.share);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setToast("복사했어요");
    } catch {
      textRef.current?.focus();
      textRef.current?.select();
      setToast("텍스트를 선택했어요. Ctrl+C로 복사해 주세요");
    }
    setTimeout(() => setToast(null), 3000);
  }

  const cols = (grouped ? 2 : single ? 0 : 1) + 5;
  const sections = sectionsOf(view, section);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3 text-sm text-[var(--color-muted)]">
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          <span>
            <b className="text-[var(--color-fg)]">{scope}</b> · {rangeLabel}
          </span>
          <span>주간공유 <b className="text-[var(--color-fg)]">{counts.shares}</b>건</span>
          {counts.others > 0 && <span>기타 업무 <b className="text-[var(--color-fg)]">{counts.others}</b>건</span>}
          {single && <span>미작성 <b className="text-[var(--color-fg)]">{counts.missing}</b>주</span>}
        </div>
        <button
          type="button"
          disabled={!copyable}
          onClick={() => setModal(true)}
          className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm font-medium text-[var(--color-fg)] disabled:opacity-50"
        >
          텍스트로 복사
        </button>
      </div>

      {msg && <p role="status" className="rounded-[10px] border border-[var(--color-danger)] px-4 py-2 text-sm text-[var(--color-danger)]">{msg}</p>}

      {view.length === 0 ? (
        <p className="rounded-[14px] border border-dashed border-[var(--color-border)] p-8 text-center text-[var(--color-muted)]">
          조건에 맞는 주간공유가 없어요.
        </p>
      ) : (
        sections.map((sec) => {
          let lastPart: string | null = null;
          let lastPm: string | null = null;
          let lastGroup = "";
          return (
            <section key={sec.title} className="overflow-hidden rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)]">
              <div className="border-b border-[var(--color-border)] px-5 py-3">
                <h2 className="text-base font-semibold">{sec.title}</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] table-fixed text-sm">
                  <colgroup>
                    {columnWidths(grouped, single).map((w, i) => (
                      <col key={i} style={{ width: `${w}%` }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr className="border-b border-[var(--color-border)]">
                      {grouped && <th className={thCls}>PM</th>}
                      {!single && <th className={thCls}>고객사</th>}
                      <th className={thCls}>주차</th>
                      <th className={thCls}>이번주</th>
                      <th className={thCls}>다음주</th>
                      <th className={thCls}>비고</th>
                      <th className={thCls}>작성</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sec.rows.map((r) => {
                      const showPart = grouped && r.pmId && (r.partName ?? "파트 미지정") !== lastPart;
                      if (showPart) {
                        lastPart = r.partName ?? "파트 미지정";
                        lastPm = null;
                        lastGroup = "";
                      }
                      const showPm = grouped && r.pmId && r.pmId !== lastPm;
                      if (showPm) {
                        lastPm = r.pmId;
                        lastGroup = "";
                      }
                      const group = `${r.pmId ?? "-"}/${r.kind === "client" ? r.clientId : "other"}`;
                      const showGroup = !single && group !== lastGroup;
                      lastGroup = group;

                      const isEditing = editing === r.key;
                      const src = r.kind === "client" ? r.share : r.other;
                      const missing = r.kind === "client" && !r.share;
                      const noSpecial = r.kind === "client" && !!r.share?.noSpecial;
                      return (
                        <Fragment key={r.key}>
                          {showPart && (
                            <tr className="bg-[var(--color-bg)]">
                              <td colSpan={cols} className="px-3 py-2 text-sm font-bold">{r.partName ?? "파트 미지정"}</td>
                            </tr>
                          )}
                          <tr className={`border-b border-[var(--color-border)] ${missing ? "text-[var(--color-muted)]" : ""}`}>
                            {grouped && <td className={`${tdCls} font-bold`}>{showPm ? r.pmName : ""}</td>}
                            {!single && (
                              <td className={`${tdCls} font-semibold`}>
                                {showGroup ? (
                                  r.kind === "client" ? (
                                    r.clientName
                                  ) : (
                                    <span className="rounded bg-[var(--color-hover)] px-2 py-0.5 text-xs font-semibold text-[var(--color-primary)]">기타 업무</span>
                                  )
                                ) : (
                                  ""
                                )}
                              </td>
                            )}
                            <td className={tdCls}>
                              <b className="block font-semibold">{weekLabel(r.weekStart)}</b>
                              <span className="text-xs text-[var(--color-muted)]">{weekRange(r.weekStart)}</span>
                              {r.kind === "other" && r.other.tags.length > 0 && (
                                <div className="mt-1 flex flex-wrap justify-center gap-1">
                                  {r.other.tags.map((t) => (
                                    <span key={t} className="rounded bg-[var(--color-bg)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--color-muted)]">{t}</span>
                                  ))}
                                </div>
                              )}
                            </td>

                            {missing ? (
                              <td colSpan={3} className={`${tdCls} text-[var(--color-muted)]`}>이 주차는 아직 작성하지 않았어요.</td>
                            ) : isEditing ? (
                              <>
                                {(["thisWeek", "nextWeek", "note"] as const).map((f) => (
                                  <td key={f} className={tdCls}>
                                    <textarea
                                      aria-label={f === "thisWeek" ? "이번주" : f === "nextWeek" ? "다음주" : "비고"}
                                      value={draft[f]}
                                      disabled={draft.noSpecial}
                                      onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value, ...(e.target.value.trim() ? { noSpecial: false } : {}) }))}
                                      className={areaCls}
                                    />
                                  </td>
                                ))}
                              </>
                            ) : noSpecial ? (
                              <>
                                <td className={txtCls}><span className="text-[var(--color-muted)]">특이사항 없음</span></td>
                                <td className={txtCls}>—</td>
                                <td className={txtCls}>—</td>
                              </>
                            ) : (
                              <>
                                <td className={txtCls}>{src!.thisWeek || "—"}</td>
                                <td className={txtCls}>{src!.nextWeek || "—"}</td>
                                <td className={txtCls}>{src!.note || "—"}</td>
                              </>
                            )}

                            <td className={tdCls}>
                              {missing ? (
                                <>
                                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500">미작성</span>
                                  {writer && (
                                    <div className="mt-1">
                                      <Link
                                        href={`/weekly-share?tab=batch&ym=${ymValue(weekMonth(r.weekStart))}&week=${r.weekStart}`}
                                        className="text-sm font-medium text-[var(--color-primary)]"
                                      >
                                        작성하기
                                      </Link>
                                    </div>
                                  )}
                                </>
                              ) : isEditing ? (
                                <div className="flex flex-col items-center gap-2">
                                  {r.kind === "client" && (
                                    <label className="inline-flex select-none items-center gap-1.5 text-xs text-[var(--color-muted)]">
                                      <input type="checkbox" checked={draft.noSpecial} onChange={(e) => setDraft((d) => ({ ...d, noSpecial: e.target.checked }))} />
                                      특이사항 없음
                                    </label>
                                  )}
                                  <div className="flex gap-2">
                                    <button type="button" disabled={pending} onClick={() => save(r)} className="rounded bg-[var(--color-primary)] px-3 py-1.5 text-xs text-white disabled:opacity-60">
                                      {pending ? "저장 중…" : "저장"}
                                    </button>
                                    <button type="button" disabled={pending} onClick={() => setEditing(null)} className="rounded border border-[var(--color-border)] px-3 py-1.5 text-xs">
                                      취소
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <div className="text-xs leading-relaxed text-[var(--color-muted)]">
                                    {r.kind === "client"
                                      ? describeShareStamp(r.share!)
                                      : describeShareStamp({ createdByName: r.pmName, updatedByName: r.pmName, createdAt: r.other.createdAt, editedAt: r.other.editedAt })}
                                  </div>
                                  {editable.has(r.key) && (
                                    <button type="button" onClick={() => startEdit(r)} className="mt-1 text-sm font-medium text-[var(--color-primary)]">
                                      수정
                                    </button>
                                  )}
                                </>
                              )}
                            </td>
                          </tr>
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })
      )}

      {modal && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModal(false);
          }}
        >
          <div role="dialog" aria-modal="true" aria-label="주간공유 텍스트" className="flex max-h-full w-[min(640px,100%)] flex-col gap-3 overflow-y-auto rounded-[14px] bg-[var(--color-surface)] p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">주간공유 텍스트</h2>
              <button type="button" onClick={() => setModal(false)} className="text-sm font-medium text-[var(--color-primary)]">닫기</button>
            </div>
            <p className="text-xs text-[var(--color-muted)]">지금 조회한 조건 그대로예요. 메일이나 메신저에 붙여 넣을 수 있어요.</p>
            <textarea ref={textRef} readOnly value={text} className="h-80 w-full rounded-[10px] border border-[var(--color-border)] p-3 text-[13px] leading-relaxed" />
            <div className="flex justify-end">
              <button type="button" onClick={copy} className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white">복사하기</button>
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-[10px] bg-[var(--color-fg)] px-4 py-2 text-sm text-white">
          {toast}
        </div>
      )}
    </div>
  );
}
