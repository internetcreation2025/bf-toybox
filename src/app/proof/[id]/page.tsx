"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { resizeImage } from "@/lib/image";
import { RARITY_META, type Rarity } from "@/lib/decider";
import { ForensicCard, type Verification } from "@/components/ForensicCard";

type Challenge = {
  id: string;
  rarity: Rarity;
  instruction: string;
  flavor: string | null;
  proof_required_json: string[] | null;
  proof_photo_path: string | null;
  status: string;
  verification_json: Verification | null;
};

type StreakOutcome = {
  result: "pass" | "fail";
  current_streak: number;
  longest_streak: number;
  freeze_tokens: number;
  freeze_used: boolean;
  token_awarded: boolean;
};

export default function ProofPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const supabase = createClient();

  const [userId, setUserId] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [proofUrl, setProofUrl] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [streak, setStreak] = useState<StreakOutcome | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refreshProofUrl = useCallback(
    async (path: string | null) => {
      if (!path) {
        setProofUrl(undefined);
        return;
      }
      const { data } = await supabase.storage
        .from("bf-feet")
        .createSignedUrl(path, 3600);
      setProofUrl(data?.signedUrl);
    },
    [supabase]
  );

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const { data } = await supabase
      .from("bf_challenges")
      .select(
        "id, rarity, instruction, flavor, proof_required_json, proof_photo_path, status, verification_json"
      )
      .eq("id", id)
      .maybeSingle();

    setChallenge((data as Challenge) ?? null);
    await refreshProofUrl((data as Challenge)?.proof_photo_path ?? null);
    setLoading(false);
  }, [supabase, id, refreshProofUrl]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleUpload(file: File) {
    if (!userId || !challenge) return;
    setBusy(true);
    setError("");
    try {
      const blob = await resizeImage(file);
      const path = `${userId}/proofs/${challenge.id}.jpg`;

      const { error: upErr } = await supabase.storage
        .from("bf-feet")
        .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
      if (upErr) throw upErr;

      const { error: rowErr } = await supabase
        .from("bf_challenges")
        .update({ proof_photo_path: path })
        .eq("id", challenge.id);
      if (rowErr) throw rowErr;

      await refreshProofUrl(path);

      const res = await fetch("/api/proof/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: challenge.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Verification failed");

      setStreak(json.streak as StreakOutcome | null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-xl p-8">
        <p className="text-sm text-neutral-500">Loading…</p>
      </main>
    );
  }

  if (!challenge) {
    return (
      <main className="mx-auto max-w-xl p-8">
        <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">
          ← Dashboard
        </Link>
        <p className="mt-4 text-sm text-neutral-500">
          That challenge couldn&apos;t be found.
        </p>
      </main>
    );
  }

  const resolved = challenge.status === "verified" || challenge.status === "failed";
  const meta = RARITY_META[challenge.rarity];
  const requiredElements = challenge.proof_required_json ?? [];

  return (
    <main className="mx-auto max-w-xl p-8">
      <Link
        href="/"
        className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
      >
        ← Dashboard
      </Link>

      <div className="mt-2 flex items-center gap-3">
        <span
          className="rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white"
          style={{ backgroundColor: meta.colour }}
        >
          {meta.label}
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">Prove it</h1>
      </div>

      {challenge.flavor && (
        <p className="mt-3 text-lg font-medium italic">{challenge.flavor}</p>
      )}
      <p className="mt-2 text-base">{challenge.instruction}</p>

      {/* Resolved → show the forensic card */}
      {resolved && challenge.verification_json ? (
        <>
          {streak && <StreakBanner streak={streak} />}
          <div className="mt-6">
            <ForensicCard
              verification={challenge.verification_json}
              proofUrl={proofUrl}
              rarity={challenge.rarity}
            />
          </div>
          <div className="mt-6 flex gap-2">
            <Link
              href="/archive"
              className="flex-1 rounded-lg border border-neutral-300 px-4 py-3 text-center text-sm dark:border-neutral-700"
            >
              View archive
            </Link>
            <Link
              href="/roll"
              className="flex-1 rounded-lg bg-neutral-900 px-4 py-3 text-center text-sm font-medium text-white hover:opacity-90 dark:bg-white dark:text-neutral-900"
            >
              Roll again
            </Link>
          </div>
        </>
      ) : (
        <>
          {/* Checklist of what the proof must contain */}
          {requiredElements.length > 0 && (
            <div className="mt-6 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Your proof photo must clearly show
              </p>
              <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-neutral-600 dark:text-neutral-300">
                {requiredElements.map((el, i) => (
                  <li key={i}>{el}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Upload */}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="mt-6 flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border-2 border-dashed border-neutral-300 bg-neutral-50 text-neutral-400 transition-colors hover:border-neutral-400 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-950"
          >
            {proofUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={proofUrl}
                alt="Proof"
                className="h-full w-full object-cover"
              />
            ) : (
              <>
                <span className="text-4xl">📷</span>
                <span className="text-sm">Tap to add your proof photo</span>
              </>
            )}
          </button>

          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
              e.target.value = "";
            }}
          />

          {busy && (
            <p className="mt-4 text-center text-sm text-neutral-500">
              Examining your proof… this can take a few seconds.
            </p>
          )}
          {error && (
            <p className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-950/40">
              {error}
            </p>
          )}
        </>
      )}
    </main>
  );
}

function StreakBanner({ streak }: { streak: StreakOutcome }) {
  if (streak.result === "pass") {
    return (
      <div className="mt-6 rounded-xl border border-green-300 bg-green-50 p-4 text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300">
        <p className="font-semibold">Dare verified — streak now {streak.current_streak}.</p>
        {streak.token_awarded && (
          <p className="mt-1 text-sm">
            You earned a streak-freeze token for hitting {streak.current_streak} in a row.
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="mt-6 rounded-xl border border-red-300 bg-red-50 p-4 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
      {streak.freeze_used ? (
        <>
          <p className="font-semibold">
            Proof rejected — but a freeze token saved your streak.
          </p>
          <p className="mt-1 text-sm">
            Streak held at {streak.current_streak}. Freeze tokens left:{" "}
            {streak.freeze_tokens}.
          </p>
        </>
      ) : (
        <p className="font-semibold">Proof rejected — streak reset to 0.</p>
      )}
    </div>
  );
}
