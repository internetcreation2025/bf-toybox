"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type GameMemory = { id: string; title: string; sport: string | null };

export function GameFollowup({ memory }: { memory: GameMemory }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [rating, setRating] = useState<number | null>(null);

  async function answer(result: "win" | "loss") {
    setBusy(true);
    await fetch("/api/memory/game-result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        memoryId: memory.id,
        result,
        rating: rating ?? undefined,
      }),
    });
    router.refresh();
  }

  return (
    <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950/30">
      <p className="text-sm font-medium">{memory.title}</p>
      <p className="mt-1 text-xs text-neutral-500">
        Be honest — a loss, or rating your play low, makes the next dares
        harsher.
      </p>

      {/* Optional 1–5 self-rating */}
      <div className="mt-3">
        <p className="text-xs text-neutral-500">Rate your play (optional)</p>
        <div className="mt-1.5 flex gap-1.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => setRating((r) => (r === n ? null : n))}
              className={`h-8 w-8 rounded-lg border text-sm font-medium transition-colors ${
                rating === n
                  ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                  : "border-neutral-300 text-neutral-500 dark:border-neutral-700"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
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
