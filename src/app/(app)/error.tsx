"use client";

// (app) 라우트 그룹 에러 경계.
// 서버 렌더 중 예외(예: 배포 코드와 DB 스키마 불일치)가 나도 통짜 서버 오류 화면
// 대신 사용자에게 재시도 경로를 제공한다. 근본 예방은 배포 시 prisma migrate
// deploy 자동화(package.json의 vercel-build)이며, 이 화면은 사고 시 체감 완화용.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-8">
        <h1 className="mb-2 text-lg font-semibold text-[var(--color-fg)]">
          화면을 불러오지 못했습니다
        </h1>
        <p className="mb-1 text-sm text-[var(--color-muted)]">
          일시적인 오류일 수 있습니다. 다시 시도해 주세요.
        </p>
        {error.digest && (
          <p className="mb-4 text-xs text-[var(--color-muted)]">오류 코드: {error.digest}</p>
        )}
        <button
          onClick={reset}
          className="mt-2 rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-fg)] hover:bg-black/5"
        >
          다시 시도
        </button>
      </div>
    </div>
  );
}
