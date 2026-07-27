import Link from "next/link";
import type { ExpenseTab, ExpenseTabKey } from "./tabs";

export function ExpenseTabs({
  tabs,
  current,
}: {
  tabs: readonly ExpenseTab[];
  current: ExpenseTabKey;
}) {
  return (
    <nav className="mb-6 flex flex-wrap gap-1 border-b border-[var(--color-border)]">
      {tabs.map((tab) => {
        const active = tab.key === current;
        return (
          <Link
            key={tab.key}
            href={`/expenses?tab=${tab.key}`}
            className={
              active
                ? "-mb-px border-b-2 border-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-primary)]"
                : "-mb-px border-b-2 border-transparent px-4 py-2 text-sm text-[var(--color-muted)] hover:text-[var(--color-primary)]"
            }
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
