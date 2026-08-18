"use client";

import { useRef, useState } from "react";

// 고객사 설정 화면의 매뉴얼 버튼.
//  - kind="admin": 고객사 목록 화면에서 관리자만 보는 "고객사 추가" 매뉴얼.
//  - kind="pm": 고객사 프로젝트 상세 설정 화면에서 관리자·PM 모두 보는 "프로젝트·과업 설정" 매뉴얼.
export function ManualButton({ kind }: { kind: "admin" | "pm" }) {
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
      {open && <ManualModal kind={kind} onClose={() => setOpen(false)} />}
    </>
  );
}

function ManualModal({ kind, onClose }: { kind: "admin" | "pm"; onClose: () => void }) {
  const title = kind === "admin" ? "📘 관리자 매뉴얼" : "📘 PM 매뉴얼";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-[14px] bg-[var(--color-surface)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="text-[var(--color-muted)]" aria-label="닫기">✕</button>
        </div>

        <div className="overflow-y-auto pr-1 text-sm text-[var(--color-fg)]">
          {kind === "admin" ? <AdminManual /> : <PmManual />}
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
    <figure className="mb-1 mt-3 select-none overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
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

// 라벨 + 값이 채워진 가짜 입력칸.
function Field({
  label,
  value,
  w = "w-32",
  align = "left",
}: {
  label: string;
  value: string;
  w?: string;
  align?: "left" | "right";
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-[var(--color-muted)]">{label}</span>
      <div
        className={`rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-fg)] ${w} ${
          align === "right" ? "text-right" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

// 체크박스(선택/미선택) 목업.
function Check({ label, checked = false }: { label: string; checked?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-[var(--color-fg)]">
      <span
        className={`inline-flex h-4 w-4 items-center justify-center rounded-sm border ${
          checked ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white" : "border-[var(--color-border)] bg-[var(--color-surface)]"
        }`}
      >
        {checked && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
      </span>
      {label}
    </span>
  );
}

// 가짜 추가 버튼(파랑).
function FauxButton({ children }: { children: React.ReactNode }) {
  return <span className="self-end rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm text-white">{children}</span>;
}

/* ─────────── 예시 화면 ─────────── */

function ClientAddScreen() {
  return (
    <Screen caption="고객사 설정 · 고객사 추가">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="고객사명*" value="휴노" />
        <Field label="사업자 구분*" value="휴노" w="w-24" />
        <Field label="업종" value="심리검사" w="w-28" />
        <FauxButton>고객사 추가</FauxButton>
      </div>
      <div className="mt-3">
        <span className="text-xs text-[var(--color-muted)]">담당 PM* (복수 선택, 최소 1명)</span>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
          <Check label="강규민" />
          <Check label="류승환" checked />
          <Check label="류현주" />
          <Check label="심명섭" />
        </div>
      </div>
    </Screen>
  );
}

function ClientListScreen() {
  return (
    <Screen caption="고객사 설정 · 목록">
      <div className="overflow-hidden rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-sm">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-muted)]">
          <span>고객사</span>
          <span>프로젝트</span>
        </div>
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-[var(--color-fg)]">휴노</span>
          <span className="font-medium text-[var(--color-primary)]">상세 설정 ›</span>
        </div>
      </div>
    </Screen>
  );
}

function ProjectScreen() {
  return (
    <Screen caption="휴노 상세 설정 · 프로젝트 추가">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="계약 시작" value="2026-01-01" />
        <Field label="계약 종료" value="2026-12-31" />
        <div className="flex flex-col gap-1">
          <span className="text-xs text-[var(--color-muted)]">청구 주기</span>
          <div className="mt-0.5 flex gap-2">
            <Check label="월" checked /><Check label="분기" /><Check label="중간" /><Check label="최종" />
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-[var(--color-muted)]">보고 주기</span>
          <div className="mt-0.5 flex gap-2">
            <Check label="월" /><Check label="분기" checked /><Check label="중간" /><Check label="최종" checked />
          </div>
        </div>
        <Check label="실적 계약" />
        <FauxButton>프로젝트 추가</FauxButton>
      </div>
    </Screen>
  );
}

// 과업 한 건을 카드로 표시(실제 화면처럼 과업마다 별도 카드). 단가·횟수·계약금·버튼 포함.
function TaskCard({ children, unit, count, amount }: { children: React.ReactNode; unit: string; count: string; amount: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-sm">
      <span className="text-xs text-[var(--color-muted)]">과업명(분류 선택)</span>
      {children}
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <Field label="단가(원)" value={unit} w="w-28" align="right" />
        <Field label="횟수" value={count} w="w-20" align="right" />
        <Field label="계약금(자동·수정가능)" value={amount} w="w-32" align="right" />
        <FauxButton>과업 추가</FauxButton>
      </div>
    </div>
  );
}

function TaskScreen() {
  return (
    <Screen caption="휴노 · 과업 추가">
      {/* 과업 1: 고정 분류 선택 */}
      <TaskCard unit="100,000" count="10" amount="1,000,000">
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1.5">
          <Check label="전문가 상담" checked /><Check label="심리진단" /><Check label="운영 관리" /><Check label="기타" />
        </div>
      </TaskCard>

      {/* 과업 2: "기타" 선택 → 과업명 직접 입력 */}
      <p className="mb-1.5 mt-4 text-xs font-medium text-[var(--color-muted)]">「기타」 선택 시 — 과업명을 직접 입력</p>
      <TaskCard unit="300,000" count="2" amount="600,000">
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1.5">
          <Check label="전문가 상담" /><Check label="기타" checked />
        </div>
        <div className="mt-2">
          <Field label="과업명 직접 입력" value="직무 스트레스 특강" w="w-56" />
        </div>
      </TaskCard>
    </Screen>
  );
}

/* ─────────── 관리자 매뉴얼 ─────────── */

function AdminManual() {
  return (
    <>
      <section className="mb-5">
        <h3 className="mb-2 text-base font-semibold">고객사 추가</h3>
        <List>
          <li>
            <K>고객사명</K>, <K>사업자 구분</K>, <K>담당 PM</K>을 필수로 입력합니다.{" "}
            <span className="text-[#B91C1C]">(업종은 선택 입력)</span>
          </li>
          <li>
            <K>담당 PM</K>은 복수 선택이 가능하며, 최소 1명 이상을 지정해야 합니다.
          </li>
          <li>
            <K>고객사 추가</K> 버튼을 누르면 고객사가 등록됩니다.
          </li>
          <li>
            고객사가 등록되면, 배정된 PM이 해당 고객사에 들어가 <K>프로젝트</K>와 <K>과업</K>을 설정할 수 있습니다.
          </li>
        </List>
      </section>

      <ClientAddScreen />
    </>
  );
}

/* ─────────── PM 매뉴얼 (단계별 좌우 스와이프) ─────────── */

function PmManual() {
  const steps = [
    {
      title: "① 배정된 고객사 상세로 이동",
      body: (
        <>
          <List>
            <li>
              고객사 목록에서 본인에게 배정된 고객사(예: <K>휴노</K>)의 <K>상세 설정</K>을 클릭합니다.
            </li>
          </List>
          <ClientListScreen />
        </>
      ),
    },
    {
      title: "② 프로젝트 추가",
      body: (
        <>
          <List>
            <li>
              프로젝트 상세 설정에서 <K>계약 시작</K>, <K>계약 종료</K>, <K>청구 주기</K>, <K>보고 주기</K>,{" "}
              <K>실적 계약</K> 여부를 입력합니다.
              <span className="mt-1 block font-medium text-[#B91C1C]">※다년차 계약의 경우, 1년씩 기간을 구분해주세요※</span>
            </li>
            <li>
              <K>프로젝트 추가</K> 버튼을 누릅니다. (프로젝트명은 계약 기간 연도로 자동 생성됩니다.)
            </li>
          </List>
          <ProjectScreen />
        </>
      ),
    },
    {
      title: "③ 과업 입력 (산출내역서 기준)",
      body: (
        <>
          <List>
            <li>
              추가한 프로젝트에서 산출내역서에 기재된 대로 <K>과업 항목</K>, <K>단가</K>, <K>횟수</K>를 입력하고{" "}
              <K>과업 추가</K>(저장)를 누릅니다.
            </li>
            <li>
              과업명은 <K>내부 확인용</K>이므로 완전히 정확하게 입력할 필요는 없습니다.<br />
              분류 중 <K>기타</K>를 선택하면 목록에 없는 과업명을 직접 기재할 수 있습니다.
            </li>
            <li>
              <K>단가</K>와 <K>횟수</K>를 입력하면 <K>계약금이 자동으로 계산</K>됩니다. (필요 시 직접 수정 가능)
            </li>
            <li>
              <K>실적 계약</K>의 경우 <K>단가만</K> 입력하면 됩니다.
            </li>
          </List>
          <TaskScreen />
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
