"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Shows the Archivist's latest weekly digest and lets the owner generate a fresh
// one. The heavy lifting (reading the week, writing the recap) is server-side.
export function DigestPanel({
  text,
  weekEnding,
}: {
  text: string | null;
  weekEnding: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [liveText, setLiveText] = useState<string | null>(text);

  async function generate() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/chronicle/digest", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not write the digest.");
      if (json.digest) setLiveText(json.digest);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5 dark:border-neutral-800 dark:bg-neutral-900/40">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          The Archivist&apos;s digest
        </h2>
        <button
          onClick={generate}
          disabled={busy}
          className="shrink-0 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        >
          {busy ? "Writing…" : liveText ? "New digest" : "Write this week’s digest"}
        </button>
      </div>

      {weekEnding && (
        <p className="mt-1 text-xs text-neutral-400">
          Week ending {fmt(weekEnding)}
        </p>
      )}

      {liveText ? (
        <p className="mt-3 whitespace-pre-line text-sm italic leading-relaxed text-neutral-700 dark:text-neutral-200">
          {liveText}
        </p>
      ) : (
        <p className="mt-3 text-sm text-neutral-400">
          No digest yet. Generate one and the Archivist will recap your week —
          what your feet did, the sock of the week, any milestones.
        </p>
      )}

      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
    </section>
  );
}

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}
