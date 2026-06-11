"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type GameMemory = { id: string; title: string; sport: string | null };

export function GameFollowup({ memory }: { memory: GameMemory }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function answer(result: "win" | "loss") {
    setBusy(true);
    await fetch("/api/memory/game-result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memoryId: memory.id, result }),
    });
    router.refresh();
  }

  return (
    <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950/30">
      <p className="text-sm font-medium">{memory.title}</p>
      <p className="mt-1 text-xs text-neutral-500">
        Be honest — a loss or a disappointing showing makes the next dares
        harsher.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => answer("win")}
          disabled={busy}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        >
          Won / played well
        </button>
        <button
          onClick={() => answer("loss")}
          disabled={busy}
          className="rounded-lg border border-amber-400 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50 dark:text-amber-300 dark:hover:bg-amber-950/50"
        >
          Lost / disappointing
        </button>
      </div>
    </div>
  );
}
