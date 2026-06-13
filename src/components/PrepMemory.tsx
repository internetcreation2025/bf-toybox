"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createAllDayEvent } from "@/lib/gcal";

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
  const [cal, setCal] = useState<Record<string, "adding" | "added" | "error">>(
    {}
  );

  async function addToCalendar(it: PrepItem) {
    if (!it.due) return;
    setCal((c) => ({ ...c, [it.id]: "adding" }));
    try {
      await createAllDayEvent({ summary: it.title, dateIso: it.due });
      setCal((c) => ({ ...c, [it.id]: "added" }));
    } catch {
      setCal((c) => ({ ...c, [it.id]: "error" }));
    }
  }
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
              : "border-line"
          }`}
        >
          <div className="min-w-0">
            {it.due && (
              <p className="mb-1 text-xs font-medium text-muted">
                {dueNow ? "Due · " : ""}
                {fmtDue(it.due)}
              </p>
            )}
            <p className="text-sm text-neutral-700 dark:text-neutral-200">
              {it.title}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <div className="flex gap-2">
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
                className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:text-neutral-900 disabled:opacity-50 dark:border-line dark:hover:text-neutral-100"
              >
                Drop
              </button>
            </div>
            {it.due && (
              <button
                onClick={() => addToCalendar(it)}
                disabled={cal[it.id] === "adding" || cal[it.id] === "added"}
                className="text-xs text-muted hover:text-neutral-900 disabled:opacity-60 dark:hover:text-neutral-100"
              >
                {cal[it.id] === "added"
                  ? "Added to calendar ✓"
                  : cal[it.id] === "adding"
                  ? "Adding…"
                  : cal[it.id] === "error"
                  ? "Failed — retry"
                  : "Add to calendar"}
              </button>
            )}
          </div>
        </div>
        );
      })}
    </div>
  );
}
