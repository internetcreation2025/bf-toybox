"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { VerdictCard, type VerdictData } from "@/components/VerdictCard";

type SealedInfo = {
  id: string;
  status: string;
  sealed_until: string | null;
};

export default function EnvelopePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const supabase = createClient();

  const [info, setInfo] = useState<SealedInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [verdict, setVerdict] = useState<VerdictData | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    // While sealed we deliberately fetch only the metadata — never the verdict
    // — so the surprise survives until the timer is up.
    const { data } = await supabase
      .from("bf_challenges")
      .select("id, status, sealed_until")
      .eq("id", id)
      .maybeSingle();
    setInfo((data as SealedInfo) ?? null);
    setLoading(false);
  }, [supabase, id]);

  useEffect(() => {
    load();
  }, [load]);

  // Live countdown tick.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function open() {
    setOpening(true);
    setError("");
    try {
      const res = await fetch("/api/envelope/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not open envelope");
      setVerdict(json as VerdictData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open envelope");
    } finally {
      setOpening(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-xl p-8">
        <p className="text-sm text-muted">Loading…</p>
      </main>
    );
  }

  if (!info) {
    return (
      <main className="mx-auto max-w-xl p-8">
        <Link href="/" className="text-sm text-muted hover:text-neutral-900">
          ← Dashboard
        </Link>
        <p className="mt-4 text-sm text-muted">
          That envelope couldn&apos;t be found.
        </p>
      </main>
    );
  }

  const unlockAt = info.sealed_until ? new Date(info.sealed_until).getTime() : 0;
  const remaining = Math.max(0, unlockAt - now);
  const ready = remaining <= 0;
  // Already opened earlier (status moved on) but revisited without a verdict
  // loaded → re-open to fetch its content.
  const opened = info.status !== "sealed";

  return (
    <main className="mx-auto max-w-xl p-8">
      <Link
        href="/"
        className="text-sm text-muted hover:text-neutral-900 dark:hover:text-neutral-100"
      >
        ← Dashboard
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        Mystery envelope
      </h1>

      {verdict ? (
        <div className="mt-6">
          <VerdictCard data={verdict} />
          <div className="mt-6 flex gap-2">
            {verdict.proofRequired && (
              <Link
                href={`/proof/${id}`}
                className="flex-1 rounded-lg px-4 py-3 text-center text-sm font-semibold text-white hover:opacity-90"
                style={{ backgroundColor: "#a855f7" }}
              >
                Submit proof →
              </Link>
            )}
            <Link
              href="/"
              className="flex-1 rounded-lg border border-line px-4 py-3 text-center text-sm dark:border-line"
            >
              Done
            </Link>
          </div>
        </div>
      ) : (
        <div className="mt-6 flex flex-col items-center rounded-2xl border-2 border-dashed border-line bg-neutral-50 p-10 text-center dark:border-line dark:bg-neutral-950">
          <svg
            width="56"
            height="56"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-muted"
            aria-hidden
          >
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3 7 9 6 9-6" />
          </svg>
          {ready || opened ? (
            <>
              <p className="mt-4 text-sm text-muted">
                The wait is over. Open it.
              </p>
              <button
                onClick={open}
                disabled={opening}
                className="mt-5 rounded-lg bg-neutral-900 px-6 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
              >
                {opening ? "Opening…" : "Open envelope"}
              </button>
            </>
          ) : (
            <>
              <p className="mt-4 text-sm text-muted">Sealed. Unlocks in</p>
              <p className="mt-1 font-mono text-4xl font-semibold tabular-nums">
                {fmtCountdown(remaining)}
              </p>
              <p className="mt-3 text-xs text-muted">
                Come back when the timer hits zero — you can leave this page.
              </p>
            </>
          )}
          {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
        </div>
      )}
    </main>
  );
}

function fmtCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
