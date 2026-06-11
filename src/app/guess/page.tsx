"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type PoolRow = { id: string; gender: "male" | "female"; image_path: string };
type RoundItem = { id: string; gender: "male" | "female"; url: string };
type Judge = {
  outcome: "reward" | "penance";
  correct: number;
  total: number;
  text: string;
  stare: { url: string; seconds: number } | null;
};

const ROUND_SIZE = 5;

export default function GuessPage() {
  const supabase = createClient();
  const [phase, setPhase] = useState<
    "loading" | "idle" | "playing" | "judging" | "result"
  >("loading");
  const [pool, setPool] = useState<PoolRow[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const [round, setRound] = useState<RoundItem[]>([]);
  const [index, setIndex] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [picked, setPicked] = useState<"male" | "female" | null>(null);
  const [judge, setJudge] = useState<Judge | null>(null);

  const loadPool = useCallback(async () => {
    const { data } = await supabase
      .from("bf_guess_pool")
      .select("id, gender, image_path");
    setPool((data ?? []) as PoolRow[]);
    setPhase("idle");
  }, [supabase]);

  useEffect(() => {
    loadPool();
  }, [loadPool]);

  async function generate() {
    setGenerating(true);
    setError("");
    try {
      const res = await fetch("/api/guess/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ perGender: 3 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Generation failed");
      await loadPool();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function startRound() {
    setError("");
    const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, ROUND_SIZE);
    const items: RoundItem[] = [];
    for (const r of shuffled) {
      const { data } = await supabase.storage
        .from("bf-feet")
        .createSignedUrl(r.image_path, 3600);
      if (data?.signedUrl)
        items.push({ id: r.id, gender: r.gender, url: data.signedUrl });
    }
    if (items.length < ROUND_SIZE) {
      setError("Couldn't load enough images. Generate a few more.");
      return;
    }
    setRound(items);
    setIndex(0);
    setCorrect(0);
    setPicked(null);
    setJudge(null);
    setPhase("playing");
  }

  function guess(g: "male" | "female") {
    if (picked) return;
    setPicked(g);
    if (g === round[index].gender) setCorrect((c) => c + 1);
  }

  async function next() {
    if (index + 1 < round.length) {
      setIndex((i) => i + 1);
      setPicked(null);
      return;
    }
    // Round over — judge it.
    setPhase("judging");
    try {
      const res = await fetch("/api/guess/judge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ correct, total: round.length }),
      });
      const json = (await res.json()) as Judge;
      if (!res.ok) throw new Error((json as { error?: string }).error || "Judge failed");
      setJudge(json);
      setPhase("result");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Judge failed");
      setPhase("idle");
    }
  }

  const enough = pool.length >= ROUND_SIZE;

  return (
    <main className="mx-auto max-w-xl p-8">
      <Link
        href="/"
        className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
      >
        ← Dashboard
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        Foot guessing game
      </h1>
      <p className="mt-1 text-sm text-neutral-500">
        Five bare feet. Call each one — male or female. Get them right and the
        Decider rewards you; slip up and there&apos;s a penance.
      </p>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-950/40">
          {error}
        </p>
      )}

      {/* IDLE — start / manage the pool */}
      {phase === "idle" && (
        <div className="mt-8 space-y-4">
          <div className="rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
            <p className="text-sm text-neutral-500">
              Foot bank: <span className="font-semibold text-neutral-900 dark:text-neutral-100">{pool.length}</span> images
            </p>
            {enough ? (
              <button
                onClick={startRound}
                className="mt-3 w-full rounded-lg bg-neutral-900 px-4 py-3 text-sm font-medium text-white hover:opacity-90 dark:bg-white dark:text-neutral-900"
              >
                Play a round
              </button>
            ) : (
              <p className="mt-2 text-xs text-neutral-400">
                Generate at least {ROUND_SIZE} to play.
              </p>
            )}
            <button
              onClick={generate}
              disabled={generating}
              className="mt-2 w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-sm hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
            >
              {generating ? "Generating… (a few seconds)" : "Generate more feet"}
            </button>
            <p className="mt-2 text-xs text-neutral-400">
              Generating makes 6 fresh AI feet using your Google key.
            </p>
          </div>
        </div>
      )}

      {/* PLAYING */}
      {phase === "playing" && round[index] && (
        <div className="mt-8">
          <div className="flex items-center justify-between text-xs text-neutral-500">
            <span>
              {index + 1} / {round.length}
            </span>
            <span>{correct} correct</span>
          </div>
          <div className="mt-2 overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={round[index].url}
              alt="Guess the foot"
              className="aspect-square w-full object-contain"
            />
          </div>

          {!picked ? (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                onClick={() => guess("male")}
                className="rounded-lg border border-neutral-300 px-4 py-3 text-sm font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
              >
                Male
              </button>
              <button
                onClick={() => guess("female")}
                className="rounded-lg border border-neutral-300 px-4 py-3 text-sm font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
              >
                Female
              </button>
            </div>
          ) : (
            <div className="mt-4">
              <div
                className={`rounded-lg p-3 text-sm font-medium ${
                  picked === round[index].gender
                    ? "bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-300"
                    : "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300"
                }`}
              >
                {picked === round[index].gender ? "Correct" : "Wrong"} — that was a{" "}
                {round[index].gender} foot.
              </div>
              <button
                onClick={next}
                className="mt-3 w-full rounded-lg bg-neutral-900 px-4 py-3 text-sm font-medium text-white hover:opacity-90 dark:bg-white dark:text-neutral-900"
              >
                {index + 1 < round.length ? "Next" : "See the verdict"}
              </button>
            </div>
          )}
        </div>
      )}

      {phase === "judging" && (
        <p className="mt-8 text-sm text-neutral-500">The Decider is deciding…</p>
      )}

      {/* RESULT */}
      {phase === "result" && judge && (
        <ResultView judge={judge} onAgain={startRound} />
      )}
    </main>
  );
}

function ResultView({ judge, onAgain }: { judge: Judge; onAgain: () => void }) {
  const [remaining, setRemaining] = useState(judge.stare?.seconds ?? 0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!judge.stare) return;
    timerRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1 && timerRef.current) clearInterval(timerRef.current);
        return r - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [judge.stare]);

  const reward = judge.outcome === "reward";
  const done = !judge.stare || remaining <= 0;
  const mm = Math.max(0, Math.floor(remaining / 60));
  const ss = Math.max(0, remaining % 60);

  return (
    <div className="mt-8 space-y-4">
      <div
        className={`rounded-xl border-2 p-5 ${
          reward
            ? "border-green-300 bg-green-50 dark:border-green-900 dark:bg-green-950/30"
            : "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30"
        }`}
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {judge.correct} / {judge.total} — {reward ? "Reward" : "Penance"}
        </p>
        <p className="mt-2 text-base italic">{judge.text}</p>
      </div>

      {judge.stare && (
        <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="flex items-center justify-between">
            <span className="text-sm text-neutral-500">
              Stare. Don&apos;t look away.
            </span>
            <span className="text-sm font-semibold tabular-nums">
              {mm}:{String(ss).padStart(2, "0")}
            </span>
          </div>
          <div className="mt-3 overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-900">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={judge.stare.url}
              alt="Penance"
              className="aspect-square w-full object-contain"
            />
          </div>
        </div>
      )}

      <button
        onClick={onAgain}
        disabled={!done}
        className="w-full rounded-lg bg-neutral-900 px-4 py-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40 dark:bg-white dark:text-neutral-900"
      >
        {done ? "Play again" : "Keep staring…"}
      </button>
    </div>
  );
}
