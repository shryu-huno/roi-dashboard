import { requireUser } from "@/lib/auth/session";

export default async function HomePage() {
  const user = await requireUser();
  return (
    <main className="p-8">
      <h1 className="text-xl font-semibold">ROI 대시보드</h1>
      <p className="text-[var(--color-muted)]">{user.email}</p>
    </main>
  );
}
