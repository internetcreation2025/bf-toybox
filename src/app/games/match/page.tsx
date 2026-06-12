"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const ROUNDS = 5;
const ZOOM = "360%"; // extreme close-up

type Tile = { url: string; bgX: number; bgY: number; his: boolean };
type Question = { tiles: Tile[]; answer: number };
type Judge = { outcome: "reward" | "penance"; text: string };

function rnd(min: number, max: number) {
  return min + Math.floor(Math.random() * (max - min));
}
function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}
function tileFor(url: string, his: boolean): Tile {
  return { url, his, bgX: rnd(20, 80), bgY: rnd(20, 80) };
}

export default function MatchGamePage() {
  const supabase = createClient();
  const [mine, setMine] = useState<string[]>([]);
  const [decoys, setDecoys] = useState<string[]>([]);
  const [phase, setPhase] = useState<"loading" | "idle" | "playing" | "done">(
    "loading"
  );
  const [questions, setQuestions] = useState<Question[]>([]);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [correct, setCorrect] = useState(0);
  const [judge, setJudge] = useState<Judge | null>(null);

  const load = useCallback(async () => {
    const [{ data: refs }, { data: pool }] = await Promise.all([
      supabase.from("bf_foot_refs").select("photo_path"),
      supabase.from("bf_guess_pool").select("image_path"),
    ]);
    const sign = async (path: string) => {
      const { data } = await supabase.storage
        .from("bf-feet")
        .createSignedUrl(path, 3600);
      return data?.signedUrl;
    };
    const mineUrls: string[] = [];
    for (const r of refs ?? []) {
      const u = await sign(r.photo_path as string);
      if (u) mineUrls.push(u);
    }
    const decoyUrls: string[] = [];
    for (const p of pool ?? []) {
      const u = await sign(p.image_path as string);
      if (u) decoyUrls.push(u);
    }
    setMine(mineUrls);
    setDecoys(decoyUrls);
    setPhase("idle");
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  function start() {
    const qs: Question[] = [];
    for (let i = 0; i < ROUNDS; i++) {
      const mineUrl = mine[Math.floor(Math.random() * mine.length)];
      const picks = shuffle(decoys).slice(0, 3);
      const tiles = shuffle([
        tileFor(mineUrl, true),
        ...picks.map((u) => tileFor(u, false)),
      ]);
      qs.push({ tiles, answer: tiles.findIndex((t) => t.his) });
    }
    setQuestions(qs);
    setIndex(0);
    setPicked(null);
    setCorrect(0);
    setJudge(null);
    setPhase("playing");
  }

  function pick(i: number) {
    if (picked !== null) return;
    setPicked(i);
    if (i === questions[index].answer) setCorrect((c) => c + 1);
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
        body: JSON.stringify({ game: "match", correct, total: ROUNDS }),
      });
      setJudge((await res.json()) as Judge);
    } catch {
      setJudge({ outcome: correct >= 4 ? "reward" : "penance", text: "" });
    }
  }

  const enough = mine.length >= 1 && decoys.length >= 3;
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
        Spot your own foot
      </h1>
      <p className="mt-1 text-sm text-neutral-500">
        Four extreme close-ups, one is yours. Do you know your own feet?
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
              You need at least one of your own foot photos (
              <Link href="/feet" className="underline">
                Teach it my feet
              </Link>
              ) and a few AI feet in the{" "}
              <Link href="/guess" className="underline">
                guessing game
              </Link>{" "}
              bank.
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
          <div className="mt-2 grid grid-cols-2 gap-3">
            {q.tiles.map((t, i) => {
              const show = picked !== null;
              const border = !show
                ? "border-neutral-200 dark:border-neutral-800"
                : t.his
                ? "border-green-400"
                : i === picked
                ? "border-red-400"
                : "border-neutral-200 dark:border-neutral-800";
              return (
                <button
                  key={i}
                  onClick={() => pick(i)}
                  disabled={show}
                  className={`aspect-square overflow-hidden rounded-xl border-2 ${border}`}
                  style={{
                    backgroundImage: `url(${t.url})`,
                    backgroundSize: ZOOM,
                    backgroundPosition: `${t.bgX}% ${t.bgY}%`,
                    backgroundRepeat: "no-repeat",
                  }}
                />
              );
            })}
          </div>

          {picked !== null && (
            <div className="mt-4">
              <p
                className={`rounded-lg p-3 text-sm font-medium ${
                  picked === q.answer
                    ? "bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-300"
                    : "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300"
                }`}
              >
                {picked === q.answer
                  ? "Correct — that's your foot."
                  : "Wrong — the green one was yours."}
              </p>
              <button
                onClick={next}
                className="mt-3 w-full rounded-lg bg-neutral-900 px-4 py-3 text-sm font-medium text-white hover:opacity-90 dark:bg-white dark:text-neutral-900"
              >
                {index + 1 < questions.length ? "Next" : "See the verdict"}
              </button>
            </div>
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
