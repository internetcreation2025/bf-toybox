"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { RARITY_META, type Rarity } from "@/lib/decider";

export type ActiveChallenge = {
  id: string;
  rarity: Rarity;
  verdict_type: "wear" | "dare";
  instruction: string;
  flavor: string | null;
  proof_required_json: string[] | null;
  status: string;
};

export function ActiveSession({ challenge }: { challenge: ActiveChallenge }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const meta = RARITY_META[challenge.rarity];
  const sealed = challenge.status === "sealed";
  const proofRequired = Array.isArray(challenge.proof_required_json);
  // A proof obligation can't be quietly cancelled — it stays until you submit.
  const canCancel = sealed || !proofRequired;

  async function resolve(outcome: "completed" | "cancelled") {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/challenges/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: challenge.id, outcome }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not update");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update");
      setBusy(false);
    }
  }

  return (
    <div
      className="rounded-2xl border-2 p-5"
      style={{ borderColor: meta.colour }}
    >
      <div className="flex items-center gap-2">
        <span
          className="rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-white"
          style={{ backgroundColor: meta.colour }}
        >
          {sealed ? "Sealed" : meta.label}
        </span>
        <span className="text-xs uppercase tracking-wide text-neutral-400">
          In play
        </span>
      </div>

      {sealed ? (
        <p className="mt-3 text-sm text-neutral-500">
          A sealed envelope is waiting. Open it when its timer runs out.
        </p>
      ) : (
        <>
          {challenge.flavor && (
            <p className="mt-3 text-base font-medium italic">{challenge.flavor}</p>
          )}
          <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-200">
            {challenge.instruction}
          </p>
        </>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {sealed ? (
          <Link
            href={`/envelope/${challenge.id}`}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:opacity-90 dark:bg-white dark:text-neutral-900"
          >
            Open envelope
          </Link>
        ) : proofRequired ? (
          <Link
            href={`/proof/${challenge.id}`}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            style={{ backgroundColor: "#a855f7" }}
          >
            Submit proof
          </Link>
        ) : (
          <button
            onClick={() => resolve("completed")}
            disabled={busy}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          >
            {busy ? "…" : "Mark as done"}
          </button>
        )}
        {canCancel && (
          <button
            onClick={() => resolve("cancelled")}
            disabled={busy}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-500 hover:text-neutral-900 disabled:opacity-50 dark:border-neutral-700 dark:hover:text-neutral-100"
          >
            Cancel
          </button>
        )}
      </div>

      {!canCancel && (
        <p className="mt-3 text-xs text-neutral-400">
          This one needs proof — it stays here until you submit it.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
    </div>
  );
}
