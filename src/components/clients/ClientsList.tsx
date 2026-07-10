"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type ClientItem = { id: string; name: string; status: string };

export function ClientsList({ clients }: { clients: ClientItem[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => c.name.toLowerCase().includes(q));
  }, [clients, query]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">고객사 목록</h1>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="고객사 검색"
          className="w-56 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-primary)]"
        />
      </div>
      {clients.length === 0 ? (
        <p className="text-[var(--color-muted)]">담당 고객사가 없습니다.</p>
      ) : filtered.length === 0 ? (
        <p className="text-[var(--color-muted)]">검색 결과가 없습니다.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <Link
              key={c.id}
              href={`/clients/${c.id}`}
              className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm hover:border-[var(--color-primary)]"
            >
              <div className="text-base font-medium text-[var(--color-fg)]">{c.name}</div>
              <div className="mt-1 text-xs text-[var(--color-muted)]">{c.status}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
