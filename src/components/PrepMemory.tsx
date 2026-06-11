"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type PrepItem = { id: string; title: string };

export function PrepMemory({ items }: { items: PrepItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function resolve(id: string, status: "done" | "dismissed") {
    setBusy(id);
    await fetch("/api/memory/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memoryId: id, status }),
    });
    router.refresh();
  }

  return (
    <div className="space-y-2">
      {items.map((it) => (
        <div
          key={it.id}
          className="flex items-start justify-between gap-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"
        >
          <p className="text-sm text-neutral-700 dark:text-neutral-200">
            {it.title}
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => resolve(it.id, "done")}
              disabled={busy === it.id}
              className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
            >
              Done
            </button>
            <button
              onClick={() => resolve(it.id, "dismissed")}
              disabled={busy === it.id}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-500 hover:text-neutral-900 disabled:opacity-50 dark:border-neutral-700 dark:hover:text-neutral-100"
            >
              Drop
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
