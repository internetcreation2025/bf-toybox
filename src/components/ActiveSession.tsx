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

type Ruling = { outcome: "upheld" | "harsher" | "mercy" | "error"; reply: string };

export function ActiveSession({ challenge }: { challenge: ActiveChallenge }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Negotiating with the Decider.
  const [showAppeal, setShowAppeal] = useState(false);
  const [plea, setPlea] = useState("");
  const [appealing, setAppealing] = useState(false);
  const [ruling, setRuling] = useState<Ruling | null>(null);

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

  async function sendAppeal() {
    if (!plea.trim()) return;
    setAppealing(true);
    setRuling(null);
    try {
      const res = await fetch("/api/challenges/appeal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: challenge.id, message: plea }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "The Decider didn't respond");
      setRuling({ outcome: json.outcome, reply: json.reply });
      setPlea("");
      router.refresh(); // pull the (possibly changed) verdict into the card
    } catch (e) {
      setRuling({
        outcome: "error",
        reply: e instanceof Error ? e.message : "Something went wrong.",
      });
    } finally {
      setAppealing(false);
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

      {/* Primary action */}
      <div className="mt-4">
        {sealed ? (
          <Link
            href={`/envelope/${challenge.id}`}
            className="inline-block rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:opacity-90 dark:bg-white dark:text-neutral-900"
          >
            Open envelope
          </Link>
        ) : proofRequired ? (
          <Link
            href={`/proof/${challenge.id}`}
            className="inline-block rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
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
      </div>

      {/* Secondary actions — tucked away as quiet links */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {!sealed && (
          <button
            onClick={() => setShowAppeal((v) => !v)}
            className="font-medium text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            {showAppeal ? "Close" : "Talk to the Decider"}
          </button>
        )}
        {canCancel ? (
          <button
            onClick={() => resolve("cancelled")}
            disabled={busy}
            className="text-neutral-400 hover:text-red-600 disabled:opacity-50"
          >
            Cancel
          </button>
        ) : (
          <span className="text-neutral-400">
            Needs proof — stays until you submit.
          </span>
        )}
      </div>

      {/* Negotiate panel (inline, only when opened) */}
      {!sealed && showAppeal && (
        <div className="mt-3">
          <textarea
            value={plea}
            onChange={(e) => setPlea(e.target.value)}
            rows={2}
            placeholder="Reason with the Decider… (it may soften this, or make it worse)"
            className="w-full rounded-lg border border-neutral-300 p-2.5 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950"
          />
          <button
            onClick={sendAppeal}
            disabled={appealing || !plea.trim()}
            className="mt-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          >
            {appealing ? "Putting your case…" : "Send"}
          </button>
        </div>
      )}

      {ruling && (
        <div
          className={`mt-3 rounded-xl p-3 text-sm ${
            ruling.outcome === "mercy"
              ? "bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-300"
              : ruling.outcome === "harsher"
              ? "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300"
              : "bg-neutral-50 text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
          }`}
        >
          {ruling.outcome !== "error" && (
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide">
              {ruling.outcome === "mercy"
                ? "Mercy"
                : ruling.outcome === "harsher"
                ? "Harsher"
                : "Upheld"}
            </p>
          )}
          <p className="italic">{ruling.reply}</p>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
    </div>
  );
}
