// 페이지 전환 시 서버 렌더가 끝나기 전에 즉시 표시되는 스켈레톤.
// 없으면 클릭 후 응답까지 화면이 그대로 멈춰 있어 느리게 느껴진다.
export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="mb-4 h-7 w-40 rounded bg-black/10" />
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-24 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)]" />
        ))}
      </div>
      <div className="mb-8 h-48 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)]" />
      <div className="h-64 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)]" />
    </div>
  );
}
