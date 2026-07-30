import Link from "next/link";

function pageHref(field: string, q: string, page: number): string {
  const params = new URLSearchParams({ tab: "payment-list", field, q, page: String(page) });
  return `/expenses?${params.toString()}`;
}

// 이전/다음 + 현재 페이지 주변 최대 7개 번호 링크. totalPages가 1 이하면 아무것도 렌더링하지 않는다.
function pageWindow(page: number, totalPages: number): number[] {
  const windowSize = 7;
  let start = Math.max(1, page - 3);
  const end = Math.min(totalPages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  const pages: number[] = [];
  for (let p = start; p <= end; p++) pages.push(p);
  return pages;
}

export function PayeePager({
  page,
  totalPages,
  field,
  q,
}: {
  page: number;
  totalPages: number;
  field: string;
  q: string;
}) {
  if (totalPages <= 1) return null;

  const pages = pageWindow(page, totalPages);
  const linkClass = "rounded border border-[var(--color-border)] px-3 py-1.5 text-sm";
  const disabledClass = "cursor-not-allowed rounded border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-muted)] opacity-50";
  const currentClass = "rounded bg-[var(--color-primary)] px-3 py-1.5 text-sm text-white";

  return (
    <nav className="mt-4 flex flex-wrap items-center justify-center gap-1">
      {page > 1 ? (
        <Link href={pageHref(field, q, page - 1)} className={linkClass}>이전</Link>
      ) : (
        <span className={disabledClass}>이전</span>
      )}
      {pages.map((p) =>
        p === page ? (
          <span key={p} className={currentClass}>{p}</span>
        ) : (
          <Link key={p} href={pageHref(field, q, p)} className={linkClass}>{p}</Link>
        ),
      )}
      {page < totalPages ? (
        <Link href={pageHref(field, q, page + 1)} className={linkClass}>다음</Link>
      ) : (
        <span className={disabledClass}>다음</span>
      )}
    </nav>
  );
}
