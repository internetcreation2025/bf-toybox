"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const ROUNDS = 5;

type Spot = { url: string; label: string };
type Question = { url: string; options: string[]; answer: string };
type Judge = { outcome: "reward" | "penance"; text: string };

function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

export default function PartGamePage() {
  const supabase = createClient();
  const [spots, setSpots] = useState<Spot[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [phase, setPhase] = useState<"loading" | "idle" | "playing" | "done">(
    "loading"
  );
  const [questions, setQuestions] = useState<Question[]>([]);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [correct, setCorrect] = useState(0);
  const [judge, setJudge] = useState<Judge | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("bf_foot_refs")
      .select("label, photo_path")
      .eq("angle", "detail")
      .not("label", "is", null);
    const list: Spot[] = [];
    for (const r of data ?? []) {
      const { data: u } = await supabase.storage
        .from("bf-feet")
        .createSignedUrl(r.photo_path as string, 3600);
      if (u?.signedUrl) list.push({ url: u.signedUrl, label: r.label as string });
    }
    setSpots(list);
    setLabels([...new Set(list.map((s) => s.label))]);
    setPhase("idle");
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  function start() {
    const qs: Question[] = [];
    for (let i = 0; i < ROUNDS; i++) {
      const spot = spots[Math.floor(Math.random() * spots.length)];
      const others = shuffle(labels.filter((l) => l !== spot.label)).slice(0, 3);
      qs.push({
        url: spot.url,
        answer: spot.label,
        options: shuffle([spot.label, ...others]),
      });
    }
    setQuestions(qs);
    setIndex(0);
    setPicked(null);
    setCorrect(0);
    setJudge(null);
    setPhase("playing");
  }

  function pick(label: string) {
    if (picked) return;
    setPicked(label);
    if (label === questions[index].answer) setCorrect((c) => c + 1);
  }

  async function next() {
    if (index + 1 < questions.length) {
      setIndex((i) => i + 1);
      setPicked(null);
      return;
    }
    setPhase("done");
    try {
      const res = await fetch("/api/games/judge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game: "part", correct, total: ROUNDS }),
      });
      setJudge((await res.json()) as Judge);
    } catch {
      setJudge({ outcome: correct >= 4 ? "reward" : "penance", text: "" });
    }
  }

  const enough = labels.length >= 4;
  const q = questions[index];

  return (
    <main className="mx-auto max-w-xl p-8">
      <Link
        href="/games"
        className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
      >
        ← Games
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Name the part</h1>
      <p className="mt-1 text-sm text-neutral-500">
        A close-up of one of your own labelled spots. Which one is it?
      </p>

      {phase === "idle" && (
        <div className="mt-8 rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
          {enough ? (
            <button
              onClick={start}
              className="w-full rounded-lg bg-neutral-900 px-4 py-3 text-sm font-medium text-white hover:opacity-90 dark:bg-white dark:text-neutral-900"
            >
              Play a round
            </button>
          ) : (
            <p className="text-sm text-neutral-500">
              Add at least 4 differently-labelled detail close-ups under{" "}
              <Link href="/feet" className="underline">
                Teach it my feet
              </Link>{" "}
              to play.
            </p>
          )}
        </div>
      )}

      {phase === "playing" && q && (
        <div className="mt-8">
          <div className="flex items-center justify-between text-xs text-neutral-500">
            <span>
              {index + 1} / {questions.length}
            </span>
            <span>{correct} correct</span>
          </div>
          <div className="mt-2 flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={q.url}
              alt="Which spot?"
              className="max-h-full max-w-full object-contain"
            />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2">
            {q.options.map((opt) => {
              const show = picked !== null;
              return (
                <button
                  key={opt}
                  onClick={() => pick(opt)}
                  disabled={show}
                  className={`rounded-lg border px-4 py-3 text-left text-sm font-medium transition-colors ${
                    show && opt === q.answer
                      ? "border-green-400 bg-green-50 dark:bg-green-950/40"
                      : show && opt === picked
                      ? "border-red-400 bg-red-50 dark:bg-red-950/40"
                      : "border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
                  }`}
                >
                  {opt}
                </button>
              );
            })}
          </div>

          {picked && (
            <button
              onClick={next}
              className="mt-4 w-full rounded-lg bg-neutral-900 px-4 py-3 text-sm font-medium text-white hover:opacity-90 dark:bg-white dark:text-neutral-900"
            >
              {index + 1 < questions.length ? "Next" : "See the verdict"}
            </button>
          )}
        </div>
      )}

      {phase === "done" && judge && (
        <div className="mt-8 space-y-4">
          <div
            className={`rounded-xl border-2 p-5 ${
              judge.outcome === "reward"
                ? "border-green-300 bg-green-50 dark:border-green-900 dark:bg-green-950/30"
                : "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30"
            }`}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              {correct} / {ROUNDS} — {judge.outcome === "reward" ? "Reward" : "Penance"}
            </p>
            {judge.text && <p className="mt-2 text-base italic">{judge.text}</p>}
          </div>
          <button
            onClick={start}
            className="w-full rounded-lg bg-neutral-900 px-4 py-3 text-sm font-medium text-white hover:opacity-90 dark:bg-white dark:text-neutral-900"
          >
            Play again
          </button>
        </div>
      )}
    </main>
  );
}
