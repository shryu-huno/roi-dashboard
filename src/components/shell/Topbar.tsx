import { signOut } from "@/lib/auth";
import { roleLabel } from "@/lib/labels";
import type { AppRole } from "@/lib/auth/rbac";

export function Topbar({ email, role }: { email: string; role: AppRole | null }) {
  return (
    <header className="flex items-center justify-end gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-3">
      <span className="rounded-full bg-[var(--color-bg)] px-2 py-0.5 text-xs text-[var(--color-muted)]">
        {roleLabel(role)}
      </span>
      <span className="text-sm text-[var(--color-fg)]">{email}</span>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/login" });
        }}
      >
        <button type="submit" className="rounded border border-[var(--color-border)] px-2 py-1 text-xs">
          로그아웃
        </button>
      </form>
    </header>
  );
}
