"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const ROUNDS = 5;

type Shoe = { id: string; name: string; url: string };
type Question = {
  shoe: Shoe;
  options: string[];
  bgX: number;
  bgY: number;
};
type Judge = { outcome: "reward" | "penance"; text: string };

function sample<T>(arr: T[], n: number): T[] {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n);
}

export default function FootwearGamePage() {
  const supabase = createClient();
  const [shoes, setShoes] = useState<Shoe[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [phase, setPhase] = useState<"loading" | "idle" | "playing" | "done">(
    "loading"
  );
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [correct, setCorrect] = useState(0);
  const [judge, setJudge] = useState<Judge | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("bf_footwear")
      .select("id, name, category, photo_path")
      .neq("category", "socks");
    const withPhotos = (data ?? []).filter((s) => s.photo_path);
    const signed: Shoe[] = [];
    for (const s of withPhotos) {
      const { data: u } = await supabase.storage
        .from("bf-feet")
        .createSignedUrl(s.photo_path as string, 3600);
      if (u?.signedUrl) signed.push({ id: s.id, name: s.name, url: u.signedUrl });
    }
    setShoes(signed);
    setPhase("idle");
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  function start() {
    const qs: Question[] = [];
    for (let i = 0; i < ROUNDS; i++) {
      const shoe = shoes[Math.floor(Math.random() * shoes.length)];
      const distractors = sample(
        shoes.filter((s) => s.id !== shoe.id),
        3
      ).map((s) => s.name);
      const options = [shoe.name, ...distractors].sort(() => Math.random() - 0.5);
      qs.push({
        shoe,
        options,
        bgX: 20 + Math.floor(Math.random() * 60),
        bgY: 20 + Math.floor(Math.random() * 60),
      });
    }
    setQuestions(qs);
    setIndex(0);
    setPicked(null);
    setCorrect(0);
    setJudge(null);
    setPhase("playing");
  }

  function pick(name: string) {
    if (picked) return;
    setPicked(name);
    if (name === questions[index].shoe.name) setCorrect((c) => c + 1);
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
        body: JSON.stringify({ game: "footwear", correct, total: ROUNDS }),
      });
      setJudge((await res.json()) as Judge);
    } catch {
      setJudge({ outcome: correct >= 4 ? "reward" : "penance", text: "" });
    }
  }

  const enough = shoes.length >= 4;
  const q = questions[index];

  return (
    <main className="mx-auto max-w-xl p-8">
      <Link
        href="/games"
        className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
      >
        ← Games
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        Name that footwear
      </h1>
      <p className="mt-1 text-sm text-neutral-500">
        A tight close-up of one of your own shoes. Which one is it?
      </p>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-950/40">
          {error}
        </p>
      )}

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
              Add at least 4 shoes with photos in your{" "}
              <Link href="/catalogue" className="underline">
                catalogue
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
          <div
            className="mt-2 aspect-square w-full overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900"
            style={{
              backgroundImage: `url(${q.shoe.url})`,
              backgroundSize: "320%",
              backgroundPosition: `${q.bgX}% ${q.bgY}%`,
              backgroundRepeat: "no-repeat",
            }}
          />

          <div className="mt-4 grid grid-cols-1 gap-2">
            {q.options.map((opt) => {
              const isAnswer = opt === q.shoe.name;
              const show = picked !== null;
              return (
                <button
                  key={opt}
                  onClick={() => pick(opt)}
                  disabled={show}
                  className={`rounded-lg border px-4 py-3 text-left text-sm font-medium transition-colors ${
                    show && isAnswer
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
