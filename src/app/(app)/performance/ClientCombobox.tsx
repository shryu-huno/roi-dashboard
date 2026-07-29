"use client";

import { useState } from "react";

export function ClientCombobox({
  clients, defaultClientId,
}: {
  clients: { id: string; name: string }[];
  defaultClientId?: string;
}) {
  const initial = clients.find((c) => c.id === defaultClientId);
  const [name, setName] = useState(initial?.name ?? "");
  const matched = clients.find((c) => c.name === name);

  return (
    <>
      <input
        list="client-options"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="고객사 검색"
        className="mt-1 w-48 rounded border border-[var(--color-border)] px-3 py-2 text-sm"
      />
      <datalist id="client-options">
        {clients.map((c) => (<option key={c.id} value={c.name} />))}
      </datalist>
      <input type="hidden" name="clientId" value={matched?.id ?? ""} />
    </>
  );
}
