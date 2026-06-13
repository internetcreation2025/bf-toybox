"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { RARITY_META, type Rarity } from "@/lib/decider";
import type { Verification } from "@/components/ForensicCard";

type Row = {
  id: string;
  created_at: string;
  archived_at: string | null;
  rarity: Rarity;
  verdict_type: "wear" | "dare";
  instruction: string;
  flavor: string | null;
  status: string;
  proof_required_json: string[] | null;
  proof_photo_path: string | null;
  verification_json: Verification | null;
};

export default function ArchivePage() {
  const supabase = createClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("bf_challenges")
      .select(
        "id, created_at, archived_at, rarity, verdict_type, instruction, flavor, status, proof_required_json, proof_photo_path, verification_json"
      )
      .order("created_at", { ascending: false });

    const list = (data ?? []) as Row[];
    setRows(list);

    const signed: Record<string, string> = {};
    for (const r of list) {
      if (r.proof_photo_path) {
        const { data: s } = await supabase.storage
          .from("bf-feet")
          .createSignedUrl(r.proof_photo_path, 3600);
        if (s?.signedUrl) signed[r.id] = s.signedUrl;
      }
    }
    setThumbs(signed);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const [deleting, setDeleting] = useState<string | null>(null);
  async function remove(id: string) {
    setDeleting(id);
    await fetch("/api/challenges/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengeId: id }),
    });
    await load();
    setDeleting(null);
  }

  const pending = rows.filter(
    (r) => r.status === "issued" && (r.proof_required_json?.length ?? 0) > 0
  );
  const completed = rows.filter((r) =>
    ["verified", "failed", "completed", "cancelled"].includes(r.status)
  );

  return (
    <main className="mx-auto max-w-2xl p-8">
      <Link
        href="/"
        className="text-sm text-muted hover:text-neutral-900 dark:hover:text-neutral-100"
      >
        ← Dashboard
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Archive</h1>
      <p className="mt-1 text-sm text-muted">
        Every dare you&apos;ve been set, and how it went.
      </p>

      {loading && <p className="mt-8 text-sm text-muted">Loading…</p>}

      {!loading && rows.length === 0 && (
        <p className="mt-8 text-sm text-muted">
          Nothing yet. Head to{" "}
          <Link href="/roll" className="underline">
            Roll
          </Link>{" "}
          to get your first verdict.
        </p>
      )}

      {/* Awaiting proof */}
      {pending.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Awaiting proof
          </h2>
          <div className="mt-3 space-y-3">
            {pending.map((r) => (
              <Link
                key={r.id}
                href={`/proof/${r.id}`}
                className="flex items-center justify-between rounded-xl border border-amber-300 bg-amber-50 p-4 transition-colors hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/30"
              >
                <div>
                  <RarityTag rarity={r.rarity} />
                  <p className="mt-2 text-sm">{r.instruction}</p>
                </div>
                <span className="ml-3 shrink-0 text-sm font-medium text-amber-700 dark:text-amber-400">
                  Submit proof →
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Completed */}
      {completed.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Completed
          </h2>
          <div className="mt-3 space-y-3">
            {completed.map((r) => {
              const badge = statusBadge(r.status);
              const inner = (
                <>
                  {thumbs[r.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumbs[r.id]}
                      alt="Proof"
                      className="h-16 w-16 shrink-0 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-muted dark:bg-neutral-900">
                      —
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <RarityTag rarity={r.rarity} />
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badge.classes}`}
                      >
                        {badge.label}
                      </span>
                    </div>
                    <p className="mt-1.5 truncate text-sm text-neutral-600 dark:text-neutral-300">
                      {r.instruction}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      {r.verification_json
                        ? `Match ${r.verification_json.match_confidence}% · `
                        : ""}
                      {fmtDate(r.archived_at ?? r.created_at)}
                    </p>
                  </div>
                </>
              );
              const cls =
                "flex gap-4 rounded-xl border border-line p-4 dark:border-line";
              // Only proof dares have a detail page (the forensic card).
              return badge.link ? (
                <Link
                  key={r.id}
                  href={`/proof/${r.id}`}
                  className={`${cls} transition-colors hover:border-accent`}
                >
                  {inner}
                </Link>
              ) : (
                <div key={r.id} className={cls}>
                  {inner}
                  {r.status === "cancelled" && (
                    <button
                      onClick={() => remove(r.id)}
                      disabled={deleting === r.id}
                      className="shrink-0 self-start rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:border-red-300 hover:text-red-600 disabled:opacity-50 dark:border-line"
                    >
                      {deleting === r.id ? "…" : "Delete"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}

function statusBadge(status: string): {
  label: string;
  classes: string;
  link: boolean;
} {
  switch (status) {
    case "verified":
      return {
        label: "Verified",
        classes: "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400",
        link: true,
      };
    case "completed":
      return {
        label: "Done",
        classes: "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400",
        link: false,
      };
    case "cancelled":
      return {
        label: "Cancelled",
        classes: "bg-neutral-100 text-muted dark:bg-neutral-900 dark:text-muted",
        link: false,
      };
    default:
      return {
        label: "Failed",
        classes: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400",
        link: true,
      };
  }
}

function RarityTag({ rarity }: { rarity: Rarity }) {
  const meta = RARITY_META[rarity];
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-white"
      style={{ backgroundColor: meta.colour }}
    >
      {meta.label}
    </span>
  );
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}
