import Link from "next/link";
import { navItemsForRole } from "@/lib/shell/nav";
import type { AppRole } from "@/lib/auth/rbac";

export function Sidebar({ role }: { role: AppRole | null }) {
  const items = navItemsForRole(role);
  return (
    <aside className="w-56 shrink-0 bg-[var(--color-sidebar)] p-4 text-white">
      <div className="mb-6 px-2 text-lg font-semibold">ROI 대시보드</div>
      <nav className="flex flex-col gap-1">
        {items.map((i) => (
          <Link key={i.href} href={i.href} className="rounded px-2 py-2 text-sm text-white/80 hover:bg-white/10 hover:text-white">
            {i.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
