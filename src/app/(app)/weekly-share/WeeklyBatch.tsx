"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { submitWeeklyAction } from "./actions";
import { describeShareStamp, WEEKLY_TAGS } from "@/lib/weekly-share-view";
import { formatKstDateTime } from "@/lib/week";
import type { OtherWorkView, WeeklyBatchClient, WeeklyShareView, WeeklySubmitResult } from "@/lib/data/weekly-share";

type Draft = { thisWeek: string; nextWeek: string; note: string; noSpecial: boolean };
type PerfDraft = { counts: Record<string, string>; amounts: Record<string, string>; touched: boolean };
type Card = {
  draft: Draft;
  version: number | null; // 불러온(또는 마지막으로 맞춘) 서버 기록 버전. 기록이 없으면 null
  share: WeeklyShareView | null;
  conflict: { updatedByName: string | null; current: WeeklyShareView } | null;
  message: string | null;
  perf: PerfDraft;
  perfOpen: boolean;
};
type OtherDraft = { tags: string[]; thisWeek: string; nextWeek: string; note: string };
type Banner = { kind: "ok" | "warn" | "error"; text: string };

const fromView = (v: WeeklyShareView): Draft => ({ thisWeek: v.thisWeek, nextWeek: v.nextWeek, note: v.note, noSpecial: v.noSpecial });
const hasContent = (d: Draft) => d.noSpecial || !!(d.thisWeek.trim() || d.nextWeek.trim() || d.note.trim());
const won = (n: number) => n.toLocaleString("ko-KR");

function initCard(c: WeeklyBatchClient): Card {
  const s = c.share;
  return {
    draft: s ? fromView(s) : { thisWeek: "", nextWeek: "", note: "", noSpecial: false },
    version: s?.version ?? null,
    share: s,
    conflict: null,
    message: null,
    // 실적 입력 화면과 같은 방식: 횟수 모드는 count, 금액 직접입력 모드는 amount(count 없음)로 복원한다.
    perf: {
      counts: Object.fromEntries(c.tasks.filter((t) => t.count != null).map((t) => [t.id, String(t.count)])),
      amounts: Object.fromEntries(c.tasks.filter((t) => t.count == null && t.amount != null).map((t) => [t.id, won(t.amount!)])),
      touched: false,
    },
    perfOpen: false,
  };
}

function initOther(o: OtherWorkView | null): OtherDraft {
  return { tags: o?.tags ?? [], thisWeek: o?.thisWeek ?? "", nextWeek: o?.nextWeek ?? "", note: o?.note ?? "" };
}

// 과업 한 줄의 유효 금액: 금액 직접입력이면 그 값, 아니면 단가×횟수(반올림).
function effectiveAmount(unitPrice: number, count: string, amount: string): number {
  if ((amount ?? "").trim() !== "") {
    const n = Number(amount.replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  if ((count ?? "").trim() !== "") {
    const n = Number(count);
    return Number.isFinite(n) ? Math.round(unitPrice * n) : 0;
  }
  return 0;
}

const inputCls =
  "w-full rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm leading-relaxed outline-none focus:border-[var(--color-primary)] disabled:bg-[var(--color-bg)] disabled:text-[var(--color-muted)]";
const ghostBtn = "rounded px-2 py-1 text-sm font-medium text-[var(--color-primary)] hover:bg-[var(--color-hover)] disabled:opacity-50";

export function WeeklyBatch({
  weekStart, year, month, readOnly, ownerName, clients, other,
}: {
  weekStart: string;
  year: number;
  month: number;
  readOnly: boolean;
  ownerName: string;
  clients: WeeklyBatchClient[];
  other: OtherWorkView | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [cards, setCards] = useState<Record<string, Card>>(() => Object.fromEntries(clients.map((c) => [c.id, initCard(c)])));
  const [otherDraft, setOtherDraft] = useState<OtherDraft>(() => initOther(other));
  const [otherView, setOtherView] = useState<OtherWorkView | null>(other);
  const [otherMessage, setOtherMessage] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);

  const patchCard = (id: string, fn: (c: Card) => Card) => setCards((prev) => ({ ...prev, [id]: fn(prev[id]) }));
  const setDraft = (id: string, patch: Partial<Draft>) => patchCard(id, (c) => ({ ...c, draft: { ...c.draft, ...patch } }));

  function pullPrevious(c: WeeklyBatchClient) {
    patchCard(c.id, (card) => {
      const cur = card.draft.thisWeek.trim();
      return { ...card, draft: { ...card.draft, noSpecial: false, thisWeek: cur ? `${cur}\n${c.prevNextWeek}` : c.prevNextWeek } };
    });
    setBanner({ kind: "ok", text: "지난주 계획을 이번주 칸에 넣었어요. 실제 진행한 내용으로 고쳐 주세요." });
  }

  // 이번주 칸이 비어 있고 "특이사항 없음"이 아닌 카드에만, 지난주 "다음주" 내용을 넣는다.
  function pullAllPrevious() {
    const fillable = clients.filter((c) => c.prevNextWeek && !cards[c.id].draft.thisWeek.trim() && !cards[c.id].draft.noSpecial);
    setCards((prev) => {
      const next = { ...prev };
      for (const c of fillable) next[c.id] = { ...prev[c.id], draft: { ...prev[c.id].draft, thisWeek: c.prevNextWeek } };
      return next;
    });
    setBanner({
      kind: "ok",
      text: fillable.length
        ? `${fillable.length}곳의 이번주 칸에 지난주 계획을 넣었어요. 실제 진행한 내용으로 고쳐 주세요.`
        : "채울 수 있는 빈 칸이 없어요.",
    });
  }

  function submit() {
    setBanner(null);
    const entries = clients.map((c) => ({ clientId: c.id, ...cards[c.id].draft, version: cards[c.id].version }));
    const performance = clients
      .filter((c) => cards[c.id].perf.touched)
      .map((c) => {
        const { counts, amounts } = cards[c.id].perf;
        const rows = c.tasks.flatMap((t) => {
          if ((counts[t.id] ?? "").trim() !== "") return [{ taskId: t.id, count: counts[t.id], amount: "" }];
          if ((amounts[t.id] ?? "").trim() !== "") return [{ taskId: t.id, count: "", amount: amounts[t.id].replace(/,/g, "") }];
          return []; // 비워 두면 저장하지 않는다(실적 입력 화면과 동일)
        });
        return { clientId: c.id, year, month, rows };
      })
      .filter((p) => p.rows.length > 0);

    startTransition(async () => {
      const out = await submitWeeklyAction({
        weekStart,
        entries,
        other: otherDraft,
        performance,
      });
      if (!out.ok) {
        setBanner({ kind: "error", text: out.error });
        return;
      }
      applyResult(out.result);
      router.refresh();
    });
  }

  function applyResult(r: WeeklySubmitResult) {
    setCards((prev) => {
      const next = { ...prev };
      for (const c of clients) {
        const card: Card = { ...prev[c.id], perf: { ...prev[c.id].perf, touched: false } };
        const cur = r.current[c.id] ?? null;
        const conflict = r.conflicts.find((x) => x.clientId === c.id);
        const rejected = r.rejected.find((x) => x.clientId === c.id);
        if (conflict && cur) {
          card.conflict = { updatedByName: conflict.updatedByName, current: cur };
          card.message = null;
        } else if (rejected) {
          card.message =
            rejected.reason === "EMPTY_EXISTING"
              ? "이미 제출한 내용을 모두 비울 수는 없어요. 내용을 입력하거나 '특이사항 없음'을 선택해 주세요."
              : "담당 고객사가 아니어서 저장하지 않았어요.";
        } else {
          card.conflict = null;
          card.message = null;
          if (cur) {
            card.share = cur;
            card.version = cur.version;
            card.draft = fromView(cur);
          }
        }
        next[c.id] = card;
      }
      return next;
    });

    if (r.other === "saved" || r.other === "unchanged") {
      setOtherView(r.otherCurrent);
      setOtherMessage(null);
      if (r.otherCurrent) setOtherDraft(initOther(r.otherCurrent));
    } else if (r.other === "rejected") {
      setOtherMessage("이미 제출한 기타 업무를 모두 비울 수는 없어요. 내용을 입력해 주세요.");
    }

    const parts = [`고객사 ${r.saved.length}곳 저장`];
    if (r.unchanged.length) parts.push(`${r.unchanged.length}곳 변경 없음`);
    if (r.skipped.length) parts.push(`빈 고객사 ${r.skipped.length}곳은 저장하지 않았어요`);
    if (r.other === "saved") parts.push("기타 업무 저장");
    if (r.conflicts.length) parts.push(`${r.conflicts.length}곳은 다른 PM이 먼저 수정해서 저장하지 않았어요`);
    if (r.rejected.length) parts.push(`${r.rejected.length}곳은 저장할 수 없어요`);
    setBanner({ kind: r.ok ? "ok" : "warn", text: parts.join(" · ") });
  }

  const written = clients.filter((c) => hasContent(cards[c.id].draft)).length;
  const otherHasText = !!(otherDraft.thisWeek.trim() || otherDraft.nextWeek.trim() || otherDraft.note.trim() || otherDraft.tags.length);

  return (
    <div className="flex flex-col gap-4 pb-24">
      {readOnly && (
        <div className="rounded-[10px] bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">
          {ownerName} PM이 작성한 내용이에요. 관리자는 보기만 할 수 있어요.
        </div>
      )}
      {banner && (
        <p
          role="status"
          className={`rounded-[10px] border px-4 py-2 text-sm ${
            banner.kind === "ok"
              ? "border-[var(--color-primary)] text-[var(--color-primary)]"
              : banner.kind === "warn"
                ? "border-amber-400 text-amber-700"
                : "border-[var(--color-danger)] text-[var(--color-danger)]"
          }`}
        >
          {banner.text}
        </p>
      )}

      {!readOnly && clients.some((c) => c.prevNextWeek) && (
        <div className="flex justify-end">
          <button type="button" onClick={pullAllPrevious} className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm font-medium">
            지난주 계획 전부 가져오기
          </button>
        </div>
      )}

      {clients.length === 0 && (
        <p className="rounded-[14px] border border-dashed border-[var(--color-border)] p-8 text-center text-[var(--color-muted)]">
          담당 고객사가 없습니다.
        </p>
      )}

      {clients.map((c) => {
        const card = cards[c.id];
        const off = readOnly || card.draft.noSpecial;
        const perfOff = readOnly;
        const amount = c.tasks.reduce((sum, t) => sum + effectiveAmount(t.unitPrice, card.perf.counts[t.id] ?? "", card.perf.amounts[t.id] ?? ""), 0);
        return (
          <section key={c.id} className={`rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] ${card.draft.noSpecial ? "opacity-90" : ""}`}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-5 py-3">
              <div className="flex flex-wrap items-baseline gap-3">
                <h3 className="text-base font-semibold">
                  <Link
                    href={`/performance?clientId=${c.id}&year=${year}&month=${month}`}
                    title="실적 입력에서 보기"
                    className="hover:text-[var(--color-primary)] hover:underline"
                  >
                    {c.name} <span className="text-[var(--color-muted)]">›</span>
                  </Link>
                </h3>
                <span className="text-sm text-[var(--color-muted)]">
                  {month}월 실적 <b className="text-[var(--color-fg)]">{won(amount)}</b>원
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted)]">
                <span
                  className={`rounded-full px-2.5 py-0.5 font-medium ${card.share ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
                >
                  {card.share ? "제출됨" : "미작성"}
                </span>
                {card.share && <span>{describeShareStamp(card.share)}</span>}
              </div>
            </div>

            <div className="flex flex-col gap-3 px-5 py-4">
              <div className="grid gap-3 md:grid-cols-[1fr_1fr_0.8fr]">
                {(
                  [
                    ["thisWeek", "이번주", "이번 주에 진행한 일"],
                    ["nextWeek", "다음주", "다음 주 계획"],
                    ["note", "비고", "이슈, 요청사항"],
                  ] as const
                ).map(([field, label, placeholder]) => (
                  <label key={field} className="flex flex-col gap-1 text-sm font-semibold">
                    {label}
                    <textarea
                      value={card.draft[field]}
                      disabled={off}
                      placeholder={readOnly ? "" : placeholder}
                      onChange={(e) => setDraft(c.id, { [field]: e.target.value, ...(e.target.value.trim() ? { noSpecial: false } : {}) })}
                      className={`${inputCls} min-h-[104px] resize-y font-normal`}
                    />
                  </label>
                ))}
              </div>

              {card.conflict && (
                <div className="rounded-[10px] border border-amber-400 bg-amber-50 p-3 text-sm text-amber-800">
                  <p className="font-medium">
                    {card.conflict.updatedByName ?? "다른 PM"}이(가) 방금 이 카드를 수정해서 저장하지 않았어요. 아래 저장된 내용을 확인해 주세요.
                  </p>
                  <div className="mt-2 grid gap-2 rounded bg-white p-2 text-[var(--color-fg)] md:grid-cols-3">
                    {card.conflict.current.noSpecial ? (
                      <p className="text-[var(--color-muted)]">이번 주 특이사항 없음</p>
                    ) : (
                      (
                        [
                          ["이번주", card.conflict.current.thisWeek],
                          ["다음주", card.conflict.current.nextWeek],
                          ["비고", card.conflict.current.note],
                        ] as const
                      ).map(([l, t]) => (
                        <div key={l}>
                          <div className="text-xs font-semibold text-[var(--color-muted)]">{l}</div>
                          <div className="whitespace-pre-line">{t || "—"}</div>
                        </div>
                      ))
                    )}
                  </div>
                  <p className="mt-1 text-xs">{describeShareStamp(card.conflict.current)}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded border border-amber-500 bg-white px-3 py-1 text-xs font-medium"
                      onClick={() => patchCard(c.id, (k) => ({ ...k, draft: fromView(k.conflict!.current), version: k.conflict!.current.version, share: k.conflict!.current, conflict: null }))}
                    >
                      저장된 내용으로 바꾸기
                    </button>
                    <button
                      type="button"
                      className="rounded border border-amber-500 bg-white px-3 py-1 text-xs font-medium"
                      onClick={() => patchCard(c.id, (k) => ({ ...k, version: k.conflict!.current.version, share: k.conflict!.current, conflict: null }))}
                    >
                      내 내용 유지하고 다시 제출하기
                    </button>
                  </div>
                </div>
              )}
              {card.message && <p className="text-sm text-[var(--color-danger)]">{card.message}</p>}

              {card.perfOpen && (
                <div className="rounded-[10px] bg-[var(--color-bg)] p-3">
                  <p className="mb-2 text-xs text-[var(--color-muted)]">
                    {year}년 {month}월 실적이에요. 실적 입력 화면과 같은 숫자라 어느 쪽에서 고쳐도 같이 바뀌어요. 칸을 비워 두면 저장하지 않아요.
                  </p>
                  {c.tasks.length === 0 ? (
                    <p className="text-sm text-[var(--color-muted)]">이 달에 계약기간이 걸친 과업이 없어요. 고객사 설정에서 과업을 먼저 등록하세요.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-[var(--color-muted)]">
                          <th className="py-1 font-semibold">과업</th>
                          <th className="font-semibold">단가</th>
                          <th className="font-semibold">횟수</th>
                          <th className="font-semibold">금액</th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.tasks.map((t) => {
                          const counts = card.perf.counts;
                          const amounts = card.perf.amounts;
                          const countFilled = (counts[t.id] ?? "").trim() !== "";
                          const amountFilled = (amounts[t.id] ?? "").trim() !== "";
                          return (
                            <tr key={t.id} className="border-t border-[var(--color-border)]">
                              <td className="py-1.5 pr-3">{t.name}</td>
                              <td className="pr-3">{won(t.unitPrice)}</td>
                              <td className="pr-3">
                                <input
                                  type="number" min="0" step="any" aria-label={`${t.name} 횟수`}
                                  value={counts[t.id] ?? ""}
                                  disabled={perfOff || amountFilled}
                                  onChange={(e) => patchCard(c.id, (k) => ({ ...k, perf: { ...k.perf, touched: true, counts: { ...k.perf.counts, [t.id]: e.target.value } } }))}
                                  className="w-24 rounded border border-[var(--color-border)] px-2 py-1 disabled:bg-[var(--color-border)] disabled:text-[var(--color-muted)]"
                                />
                              </td>
                              <td>
                                <input
                                  type="text" inputMode="numeric" aria-label={`${t.name} 금액`}
                                  value={countFilled ? won(effectiveAmount(t.unitPrice, counts[t.id], "")) : amounts[t.id] ?? ""}
                                  disabled={perfOff || countFilled}
                                  onChange={(e) => {
                                    const digits = e.target.value.replace(/[^\d]/g, "");
                                    patchCard(c.id, (k) => ({
                                      ...k,
                                      perf: { ...k.perf, touched: true, amounts: { ...k.perf.amounts, [t.id]: digits === "" ? "" : won(Number(digits)) } },
                                    }));
                                  }}
                                  className="w-32 rounded border border-[var(--color-border)] px-2 py-1 disabled:bg-[var(--color-border)] disabled:text-[var(--color-muted)]"
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1">
                  <button type="button" aria-expanded={card.perfOpen} className={ghostBtn} onClick={() => patchCard(c.id, (k) => ({ ...k, perfOpen: !k.perfOpen }))}>
                    {card.perfOpen ? "▾" : "▸"} {month}월 실적 횟수 {readOnly ? "보기" : "수정"}
                  </button>
                  {!readOnly && c.prevNextWeek && (
                    <button type="button" className={ghostBtn} onClick={() => pullPrevious(c)}>
                      지난주 계획 가져오기
                    </button>
                  )}
                </div>
                <label className="inline-flex select-none items-center gap-2 text-sm text-[var(--color-muted)]">
                  <input
                    type="checkbox"
                    checked={card.draft.noSpecial}
                    disabled={readOnly}
                    onChange={(e) => setDraft(c.id, { noSpecial: e.target.checked })}
                  />
                  이번 주 특이사항 없음
                </label>
              </div>
            </div>
          </section>
        );
      })}

      {/* 기타 업무: PM 한 명당 주 1건 */}
      <section className="rounded-[14px] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-5 py-3">
          <div className="flex flex-wrap items-baseline gap-3">
            <h3 className="text-base font-semibold">기타 업무</h3>
            <span className="text-sm text-[var(--color-muted)]">TF · 타 고객사 지원 · 내부 업무 · 없으면 비워 두세요</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
            <span className={`rounded-full px-2.5 py-0.5 font-medium ${otherView ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
              {otherView ? "제출됨" : "미작성"}
            </span>
            {otherView && (
              <span>
                {formatKstDateTime(otherView.createdAt)}
                {otherView.editedAt ? ` · 수정됨 ${formatKstDateTime(otherView.editedAt)}` : ""}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-3 px-5 py-4">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="업무 구분">
            <span className="mr-1 text-sm font-semibold text-[var(--color-muted)]">구분</span>
            {WEEKLY_TAGS.map((t) => {
              const on = otherDraft.tags.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={on}
                  disabled={readOnly}
                  onClick={() => setOtherDraft((d) => ({ ...d, tags: on ? d.tags.filter((x) => x !== t) : [...d.tags, t] }))}
                  className={`h-8 rounded-full border px-3 text-sm disabled:opacity-60 ${
                    on ? "border-[var(--color-primary)] bg-[var(--color-hover)] font-semibold text-[var(--color-primary)]" : "border-[var(--color-border)] text-[var(--color-muted)]"
                  }`}
                >
                  {t}
                </button>
              );
            })}
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_0.8fr]">
            {(
              [
                ["thisWeek", "이번주", "예: 사내 매뉴얼 개정 TF 회의 참석"],
                ["nextWeek", "다음주", "다음 주 계획"],
                ["note", "비고", "공유할 내용"],
              ] as const
            ).map(([field, label, placeholder]) => (
              <label key={field} className="flex flex-col gap-1 text-sm font-semibold">
                {label}
                <textarea
                  value={otherDraft[field]}
                  disabled={readOnly}
                  placeholder={readOnly ? "" : placeholder}
                  onChange={(e) => setOtherDraft((d) => ({ ...d, [field]: e.target.value }))}
                  className={`${inputCls} min-h-[104px] resize-y font-normal`}
                />
              </label>
            ))}
          </div>
          {otherMessage && <p className="text-sm text-[var(--color-danger)]">{otherMessage}</p>}
        </div>
      </section>

      {!readOnly && (
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3 shadow-[0_-4px_16px_rgba(20,24,40,0.08)]">
          <div className="flex items-center gap-3 text-sm text-[var(--color-muted)]">
            <div className="h-1.5 w-36 overflow-hidden rounded-full bg-[var(--color-bg)]">
              <div className="h-full rounded-full bg-[var(--color-primary)] transition-[width]" style={{ width: `${clients.length ? Math.round((written / clients.length) * 100) : 0}%` }} />
            </div>
            <span>
              고객사 {clients.length}곳 중 <b className="text-[var(--color-fg)]">{written}곳</b> 작성{otherHasText ? " · 기타 업무 작성됨" : ""}
              {written < clients.length ? " · 빈 고객사는 저장되지 않아요" : ""}
            </span>
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="rounded bg-[var(--color-primary)] px-5 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {pending ? "제출 중…" : "제출"}
          </button>
        </div>
      )}
    </div>
  );
}
