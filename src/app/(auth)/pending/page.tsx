export default function PendingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2">
      <h1 className="text-xl font-semibold">승인 대기 중</h1>
      <p className="text-[var(--color-muted)]">
        관리자가 계정을 승인하고 역할을 지정하면 대시보드를 이용할 수 있습니다.
      </p>
    </main>
  );
}
