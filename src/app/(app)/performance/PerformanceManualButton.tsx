"use client";

import { useRef, useState } from "react";

// 실적 입력 화면의 매뉴얼 버튼. 조회 → 입력(횟수/금액) → 누적 확인 3단계를 좌우 스와이프로 안내한다.
// settings/clients의 ManualButton과 동일한 방식(버튼·모달·목업 프리미티브·단계 스와이프)을 따르되,
// 실적 입력 화면에만 쓰이므로 이 파일에서 자체 완결로 구성한다.
export function PerformanceManualButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90"
      >
        📘 매뉴얼
      </button>
      {open && <ManualModal onClose={() => setOpen(false)} />}
    </>
  );
}

function ManualModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-[14px] bg-[var(--color-surface)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">📘 실적 입력 매뉴얼</h2>
          <button type="button" onClick={onClose} className="text-[var(--color-muted)]" aria-label="닫기">✕</button>
        </div>

        <div className="overflow-y-auto pr-1 text-sm text-[var(--color-fg)]">
          <PerformanceManual />
        </div>
      </div>
    </div>
  );
}

const K = ({ children }: { children: React.ReactNode }) => (
  <span className="font-semibold text-[var(--color-fg)]">{children}</span>
);

function List({ children }: { children: React.ReactNode }) {
  return <ol className="list-decimal space-y-2 pl-5 leading-relaxed text-[var(--color-fg)]">{children}</ol>;
}

/* ─────────── 예시 화면(목업) 프리미티브 ─────────── */

// 실제 폼처럼 보이는 "창" 프레임. 캡션과 신호등 점으로 예시임을 표시한다.
function Screen({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <figure className="mb-4 mt-2 select-none overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
      <figcaption className="flex items-center gap-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#F2ACB0]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#F5D77F]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#9BD6A0]" />
        <span className="ml-2 text-xs text-[var(--color-muted)]">예시 · {caption}</span>
      </figcaption>
      <div className="pointer-events-none p-3">{children}</div>
    </figure>
  );
}

// 라벨 + 값이 채워진 가짜 입력칸. disabled=true면 비활성(회색) 칸으로 표시한다.
function Field({
  label,
  value,
  w = "w-32",
  align = "left",
  disabled = false,
}: {
  label: string;
  value: string;
  w?: string;
  align?: "left" | "right";
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-[var(--color-muted)]">{label}</span>
      <div
        className={`rounded border border-[var(--color-border)] px-3 py-1.5 text-sm ${w} ${
          align === "right" ? "text-right" : ""
        } ${disabled ? "bg-[var(--color-border)] text-[var(--color-muted)]" : "bg-[var(--color-surface)] text-[var(--color-fg)]"}`}
      >
        {value}
      </div>
    </div>
  );
}

// 가짜 버튼(파랑).
function FauxButton({ children }: { children: React.ReactNode }) {
  return <span className="self-end rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm text-white">{children}</span>;
}

/* ─────────── 예시 화면 ─────────── */

// ① 조회 폼: 고객사 · 연도 · 월 + 조회 버튼.
function QueryScreen() {
  return (
    <Screen caption="실적 입력 · 조회">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="고객사" value="휴노" w="w-40" />
        <Field label="연도" value="2026" w="w-24" align="right" />
        <Field label="월" value="8" w="w-16" align="right" />
        <FauxButton>조회</FauxButton>
      </div>
    </Screen>
  );
}

// 실적 입력표 한 행. mode에 따라 횟수칸/금액칸 중 하나가 비활성으로 보인다.
function GridRow({ name, unit, count, amount, mode }: { name: string; unit: string; count: string; amount: string; mode: "count" | "amount" }) {
  return (
    <tr className="border-t border-[var(--color-border)]">
      <td className="py-1.5 pr-2 text-[var(--color-fg)]">{name}</td>
      <td className="pr-2 text-right text-[var(--color-muted)]">{unit}</td>
      <td className="pr-2">
        <span
          className={`inline-block w-16 rounded border border-[var(--color-border)] px-2 py-1 text-right text-xs ${
            mode === "amount" ? "bg-[var(--color-border)] text-[var(--color-muted)]" : "bg-[var(--color-surface)] text-[var(--color-fg)]"
          }`}
        >
          {mode === "amount" ? "" : count}
        </span>
      </td>
      <td>
        <span
          className={`inline-block w-24 rounded border border-[var(--color-border)] px-2 py-1 text-right text-xs ${
            mode === "count" ? "bg-[var(--color-border)] text-[var(--color-muted)]" : "bg-[var(--color-surface)] text-[var(--color-fg)]"
          }`}
        >
          {amount}
        </span>
      </td>
    </tr>
  );
}

// ② 입력표: 횟수 입력(금액 자동) 행 + 금액 직접입력 행 + 합계 + 저장.
function InputScreen() {
  return (
    <Screen caption="실적 입력 · 2026년 8월 실적">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-black">2026년 8월 실적</span>
        <span className="rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm text-white">저장</span>
      </div>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="text-left text-[var(--color-muted)]">
            <th className="py-1 pr-2 font-normal">과업</th>
            <th className="pr-2 text-right font-normal">단가</th>
            <th className="pr-2 text-left font-normal">횟수</th>
            <th className="text-left font-normal">금액</th>
          </tr>
        </thead>
        <tbody>
          <GridRow name="전문가 상담" unit="100,000" count="10" amount="1,000,000" mode="count" />
          <GridRow name="정신과 치료비 지원" unit="20,000,000" count="" amount="600,000" mode="amount" />
        </tbody>
        <tfoot>
          <tr className="border-t border-[var(--color-border)] font-medium">
            <td className="py-1.5" colSpan={3}>합계</td>
            <td className="text-right">1,600,000</td>
          </tr>
        </tfoot>
      </table>
    </Screen>
  );
}

// ③ 누적표: 누적/계약 횟수·금액과 달성률.
function TotalsScreen() {
  return (
    <Screen caption="실적 입력 · 프로젝트 누적">
      <div className="mb-2">
        <span className="text-sm font-medium text-black">프로젝트 누적</span>
      </div>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="text-left text-[var(--color-muted)]">
            <th className="py-1 pr-2 font-normal">과업</th>
            <th className="pr-2 text-right font-normal">누적 횟수</th>
            <th className="pr-2 text-right font-normal">계약 횟수</th>
            <th className="pr-2 text-right font-normal">누적 금액</th>
            <th className="pr-2 text-right font-normal">계약금</th>
            <th className="text-right font-normal">달성률</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-[var(--color-border)] text-[var(--color-fg)]">
            <td className="py-1.5 pr-2">전문가 상담</td>
            <td className="pr-2 text-right">30</td>
            <td className="pr-2 text-right">40</td>
            <td className="pr-2 text-right">3,000,000</td>
            <td className="pr-2 text-right">4,000,000</td>
            <td className="text-right">75%</td>
          </tr>
        </tbody>
      </table>
    </Screen>
  );
}

/* ─────────── 실적 입력 매뉴얼 (단계별 좌우 스와이프) ─────────── */
function PerformanceManual() {
  const steps = [
    {
      title: "① 고객사·연월 조회",
      body: (
        <>
          <QueryScreen />
          <List>
            <li>
              <K>고객사</K>를 검색·선택하고 <K>연도</K>와 <K>월</K>을 지정한 뒤 <K>조회</K> 버튼을 누릅니다.
              <span className="mt-0.5 block text-[var(--color-muted)]">(연·월은 접속 시점의 현재 연월이 기본값입니다.)</span>
            </li>
            <li>
              조회를 해야만 해당 고객사의 <K>과업별 실적 입력표</K>가 나타납니다.
            </li>
            <li>
              <span className="font-medium text-[#B91C1C]">등록된 과업이 없다고 나오면</span>, 먼저 <K>고객사 설정</K>에서 해당 고객사의
              프로젝트·과업을 등록해야 합니다.
            </li>
          </List>
        </>
      ),
    },
    {
      title: "② 실적 입력 (횟수 또는 금액)",
      body: (
        <>
          <InputScreen />
          <List>
            <li>
              과업별로 <K>횟수</K>를 입력하면 <K>금액이 자동 계산</K>됩니다. (금액 = 단가 × 횟수)
            </li>
            <li>
              <K>실비처리</K>와 같이 횟수 없이 금액만 기록하는 경우, <K>금액</K> 칸에 직접 입력합니다.
            </li>
            <li>
              <K>횟수</K>를 입력하면 금액 칸이, <K>금액</K>을 입력하면 횟수 칸이 <K>비활성</K>됩니다. 둘 중 하나의 방식만 사용합니다.
            </li>
            <li>
              하단 <K>합계</K>를 확인한 뒤 우측 상단의 <K>저장</K> 버튼을 누릅니다.
            </li>
          </List>
        </>
      ),
    },
    {
      title: "③ 누적 현황 확인",
      body: (
        <>
          <TotalsScreen />
          <List>
            <li>
              저장한 실적은 아래 <K>누적표</K>에 반영됩니다. <K>누적 횟수·금액</K>과 <K>계약 횟수·계약금</K> 대비 <K>달성률</K>을 확인합니다.
            </li>
            <li>
              누적은 <K>조회한 월이 속한 프로젝트</K>의 <K>계약기간 전체</K>를 기준으로 합산됩니다. (연 경계와 무관하게 프로젝트 단위로 집계)
            </li>
            <li>
              계약 횟수·계약금이 없는 과업(예: 금액만 입력하는 과업)은 해당 항목과 달성률이 <K>—</K>로 표시됩니다.
            </li>
          </List>
        </>
      ),
    },
  ];

  const [i, setI] = useState(0);
  const startX = useRef<number | null>(null);
  const go = (n: number) => setI(Math.min(steps.length - 1, Math.max(0, n)));

  return (
    <div
      onTouchStart={(e) => (startX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (startX.current == null) return;
        const dx = e.changedTouches[0].clientX - startX.current;
        if (dx > 40) go(i - 1);
        else if (dx < -40) go(i + 1);
        startX.current = null;
      }}
    >
      {/* 단계 표시(점) */}
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--color-muted)]">STEP {i + 1} / {steps.length}</span>
        <div className="flex items-center gap-1.5">
          {steps.map((_, n) => (
            <button
              key={n}
              type="button"
              onClick={() => go(n)}
              aria-label={`${n + 1}단계`}
              className={`h-2 rounded-full transition-all ${n === i ? "w-5 bg-[var(--color-primary)]" : "w-2 bg-[var(--color-border)]"}`}
            />
          ))}
        </div>
      </div>

      <div className="min-h-[320px]">
        <h3 className="mb-2 text-base font-semibold">{steps[i].title}</h3>
        {steps[i].body}
      </div>

      {/* 좌우 이동 */}
      <div className="mt-4 flex items-center justify-between border-t border-[var(--color-border)] pt-3">
        <button
          type="button"
          onClick={() => go(i - 1)}
          disabled={i === 0}
          className="rounded-md border border-[var(--color-border)] px-4 py-1.5 text-sm text-[var(--color-fg)] transition-colors hover:bg-[var(--color-hover)] disabled:opacity-40 disabled:hover:bg-transparent"
        >
          ‹ 이전
        </button>
        <button
          type="button"
          onClick={() => go(i + 1)}
          disabled={i === steps.length - 1}
          className="rounded-md border border-[var(--color-border)] px-4 py-1.5 text-sm text-[var(--color-fg)] transition-colors hover:bg-[var(--color-hover)] disabled:opacity-40 disabled:hover:bg-transparent"
        >
          다음 ›
        </button>
      </div>
    </div>
  );
}
