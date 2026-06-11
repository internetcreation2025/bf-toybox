"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type PrepItem = { id: string; title: string; due?: string | null };

function fmtDue(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${d} ${months[(m || 1) - 1]} ${y}`;
}

export function PrepMemory({ items }: { items: PrepItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const todayIso = (() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  })();

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
      {items.map((it) => {
        const dueNow = it.due ? it.due <= todayIso : false;
        return (
        <div
          key={it.id}
          className={`flex items-start justify-between gap-3 rounded-xl border p-4 ${
            dueNow
              ? "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
              : "border-neutral-200 dark:border-neutral-800"
          }`}
        >
          <div className="min-w-0">
            {it.due && (
              <p className="mb-1 text-xs font-medium text-neutral-500">
                {dueNow ? "Due · " : ""}
                {fmtDue(it.due)}
              </p>
            )}
            <p className="text-sm text-neutral-700 dark:text-neutral-200">
              {it.title}
            </p>
          </div>
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
        );
      })}
    </div>
  );
}
