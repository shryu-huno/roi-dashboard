"use client";

import { useRef, useState } from "react";

// 설정 화면의 매뉴얼 버튼.
//  - kind="client-settings": 고객사 설정(목록) 화면. isAdmin이면 "고객사 추가"까지, 아니면 "상세 설정 이동"만.
//  - kind="project-detail": 프로젝트 상세 설정 화면. 관리자·PM 모두 동일하게 "프로젝트 추가 · 과업 입력" 안내.
export function ManualButton({ kind, isAdmin = false }: { kind: "client-settings" | "project-detail"; isAdmin?: boolean }) {
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
      {open && <ManualModal kind={kind} isAdmin={isAdmin} onClose={() => setOpen(false)} />}
    </>
  );
}

function ManualModal({
  kind,
  isAdmin,
  onClose,
}: {
  kind: "client-settings" | "project-detail";
  isAdmin: boolean;
  onClose: () => void;
}) {
  const title = kind === "client-settings" ? "📘 고객사 설정 매뉴얼" : "📘 프로젝트 상세 설정 매뉴얼";
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
          {kind === "client-settings" ? <ClientSettingsManual isAdmin={isAdmin} /> : <ProjectDetailManual />}
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

// 체크박스(선택/미선택) 목업. labelClassName으로 라벨 색을 덮어쓸 수 있다(예: 면세=검붉은색).
function Check({ label, checked = false, labelClassName = "text-[var(--color-fg)]" }: { label: string; checked?: boolean; labelClassName?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${labelClassName}`}>
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
          <Check label="PM A" />
          <Check label="PM B" checked />
          <Check label="PM C" />
          <Check label="PM D" />
          <Check label="PM E" />
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
      </div>
      <div className="mt-3 flex flex-col gap-1">
        <span className="text-xs text-[var(--color-muted)]">청구 주기</span>
        <div className="mt-0.5 flex gap-2">
          <Check label="월" checked /><Check label="분기" /><Check label="중간" /><Check label="최종" />
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

// 과업 분류 9종(TaskManager와 동일). 목업에서는 라벨만 표시한다.
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

function CategoryChecks({ selected }: { selected: string }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1.5">
      {TASK_CATEGORIES.map((c) => (
        <Check key={c} label={c} checked={c === selected} />
      ))}
    </div>
  );
}

// 과업 한 건을 카드로 표시(실제 화면처럼 과업마다 별도 카드). 단가·횟수·계약금과 제거(✕) 버튼 포함.
// 저장은 카드가 아니라 상단 "프로젝트 저장" 버튼으로 프로젝트와 함께 이뤄진다.
function TaskCard({ children, unit, count, amount, exempt = false }: { children: React.ReactNode; unit: string; count: string; amount: string; exempt?: boolean }) {
  return (
    <div className="mb-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-sm">
      <span className="text-xs text-[var(--color-muted)]">과업명(분류 선택)</span>
      {children}
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <Field label="단가(원)" value={unit} w="w-28" align="right" />
        <Field label="횟수" value={count} w="w-20" align="right" />
        <Field label="계약금(자동·수정가능)" value={amount} w="w-32" align="right" />
        {/* 면세 과업 체크(검붉은색). 부가세 포함 표시에서 제외된다. */}
        <span className="self-end pb-1.5">
          <Check label="면세" checked={exempt} labelClassName="text-[#991B1B] font-medium" />
        </span>
        <span className="self-end rounded-md p-2 text-[var(--color-muted)]" title="과업 제거" aria-hidden>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </span>
      </div>
    </div>
  );
}

function TaskScreen() {
  return (
    <Screen caption="휴노 상세 설정 · 과업 입력">
      {/* 저장은 상단 "프로젝트 저장" 버튼 하나로 프로젝트·과업을 함께 저장한다. */}
      <div className="mb-3 flex justify-end">
        <span className="inline-flex items-center gap-1.5 rounded-md bg-[#57C15E] px-4 py-1.5 text-sm font-medium text-white">
          ✓ 프로젝트 저장
        </span>
      </div>

      {/* 과업 1: 고정 분류 선택 */}
      <TaskCard unit="100,000" count="10" amount="1,000,000">
        <CategoryChecks selected="전문가 상담" />
      </TaskCard>

      {/* 과업 2: "기타" 선택 → 과업명 직접 입력. 면세 과업 예시로 「면세」 체크 표시. */}
      <p className="mb-1.5 mt-1 text-xs font-medium text-[var(--color-muted)]">「기타」 선택 시 — 과업명을 직접 입력</p>
      <TaskCard unit="300,000" count="2" amount="600,000" exempt>
        <CategoryChecks selected="기타" />
        <div className="mt-2">
          <Field label="과업명 직접 입력" value="직무 스트레스 특강" w="w-56" />
        </div>
      </TaskCard>

      {/* 과업을 더 추가할 때: 아래 "과업 추가" 버튼으로 새 과업 칸을 만든다. */}
      <span className="inline-block rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm text-white">과업 추가</span>
    </Screen>
  );
}

/* ─────────── 고객사 설정 매뉴얼 ─────────── */
// isAdmin(최고관리자·팀 관리자): "고객사 추가" + "고객사 상세 설정 이동".
// PM: "배정된 고객사 상세 설정 이동"만.
function ClientSettingsManual({ isAdmin }: { isAdmin: boolean }) {
  return (
    <>
      {isAdmin && (
        <section className="mb-9">
          <h3 className="mb-2 text-base font-semibold">고객사 추가</h3>
          <ClientAddScreen />
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
      )}

      <section className="mb-1">
        <h3 className="mb-2 text-base font-semibold">프로젝트 및 과업 설정</h3>
        {isAdmin ? (
          <p className="mb-2 leading-relaxed text-[var(--color-fg)]">
            고객사의 <K>프로젝트·과업</K>을 직접 설정해야 하는 경우, 해당 고객사의 상세 설정 화면으로 이동해 프로젝트와
            과업을 입력합니다.
          </p>
        ) : (
          <p className="mb-2 leading-relaxed text-[var(--color-fg)]">
            이 화면에서는 팀 관리자가 나에게 배정한 고객사를 확인하고, 각 고객사를 <K>프로젝트·과업</K> 단위로 설정합니다.
            먼저 설정할 고객사의 상세 화면으로 이동합니다.
          </p>
        )}
        <ClientListScreen />
        <List>
          <li>
            {isAdmin ? (
              <>
                프로젝트·과업을 설정할 고객사(예: <K>휴노</K>)의 <K>상세 설정</K>을 클릭합니다.
              </>
            ) : (
              <>
                고객사 목록에서 본인에게 배정된 고객사(예: <K>휴노</K>)의 <K>상세 설정</K>을 클릭합니다.
              </>
            )}
          </li>
          <li>
            이동한 상세 화면에서 <K>프로젝트</K>와 <K>과업</K>을 설정합니다.
            <span className="mt-0.5 block">
              (구체적인 방법은 상세 화면 우측 상단의 <K>📘 매뉴얼</K>을 참고하세요.)
            </span>
          </li>
        </List>
      </section>
    </>
  );
}

/* ─────────── 프로젝트 상세 설정 매뉴얼 (단계별 좌우 스와이프) ─────────── */
// 관리자·PM 공통: 프로젝트 추가 → 과업 입력.
function ProjectDetailManual() {
  const steps = [
    {
      title: "① 프로젝트 추가",
      body: (
        <>
          <ProjectScreen />
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
        </>
      ),
    },
    {
      title: "② 과업 입력 (산출내역서 기준)",
      body: (
        <>
          <TaskScreen />
          <List>
            <li>
              산출내역서에 기재된 대로 과업마다 <K>과업명(분류)</K>을 선택하고 <K>단가</K>, <K>횟수</K>를 입력합니다.
            </li>
            <li>
              분류는 <K>내부 확인용</K>이므로 가장 가까운 항목을 고르면 됩니다.<br />
              목록에 없으면 <K>기타</K>를 선택해 과업명을 직접 입력합니다.
            </li>
            <li>
              과업을 더 추가하려면 <K>과업 추가</K> 버튼으로 새 과업 칸을 만듭니다.<br />
              잘못 추가한 과업은 우측 <K>✕</K> 버튼으로 제거합니다.
            </li>
            <li>
              <K>단가</K>와 <K>횟수</K>를 입력하면 <K>계약금이 자동으로 계산</K>됩니다. (필요 시 직접 수정 가능)
            </li>
            <li>
              <K>실적 계약</K>의 경우 <K>단가만</K> 입력하면 됩니다.
            </li>
            <li>
              부가세가 <K>면세</K>인 과업은 계약금 우측의 <span className="font-semibold text-[#991B1B]">면세</span> 항목을 체크합니다.{" "}
              대부분의 과업은 과세이므로 <K>기본은 미체크</K>이며, 체크한 과업은{" "}
              <K>완전 부가세가 제외</K>되어 계약금·실적이 원래 금액 그대로 집계됩니다.
            </li>
            <li>
              입력을 마치면 화면 상단의 <K>프로젝트 저장</K> 버튼을 눌러 프로젝트와 과업을 <K>함께 저장</K>합니다.
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
