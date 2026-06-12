"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const ROUNDS = 3;
const TOLERANCE = 1; // within ±1 of the true index counts as right

type Judge = { outcome: "reward" | "penance"; text: string };

export default function SmellGamePage() {
  const [round, setRound] = useState(0);
  const [scenario, setScenario] = useState("");
  const [actual, setActual] = useState<number | null>(null);
  const [guess, setGuess] = useState(5);
  const [revealed, setRevealed] = useState(false);
  const [correct, setCorrect] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [judge, setJudge] = useState<Judge | null>(null);

  const loadScenario = useCallback(async () => {
    setLoading(true);
    setError("");
    setRevealed(false);
    setGuess(5);
    try {
      const res = await fetch("/api/games/smell", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not load");
      setScenario(json.scenario);
      setActual(json.actual);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadScenario();
  }, [loadScenario]);

  function lockIn() {
    if (actual === null) return;
    if (Math.abs(guess - actual) <= TOLERANCE) setCorrect((c) => c + 1);
    setRevealed(true);
  }

  async function next() {
    if (round + 1 < ROUNDS) {
      setRound((r) => r + 1);
      await loadScenario();
      return;
    }
    // Done — judge.
    setLoading(true);
    try {
      const res = await fetch("/api/games/judge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game: "smell", correct, total: ROUNDS }),
      });
      const json = (await res.json()) as Judge;
      setJudge(json);
    } catch {
      setJudge({ outcome: correct >= 2 ? "reward" : "penance", text: "" });
    } finally {
      setLoading(false);
    }
  }

  function playAgain() {
    setRound(0);
    setCorrect(0);
    setJudge(null);
    loadScenario();
  }

  const off = actual === null ? 0 : Math.abs(guess - actual);

  return (
    <main className="mx-auto max-w-xl p-8">
      <Link
        href="/games"
        className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
      >
        ← Games
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Smell-o-Meter</h1>
      <p className="mt-1 text-sm text-neutral-500">
        The Decider describes a sock&apos;s history. Guess how ripe it is, 0 to 10.
      </p>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-950/40">
          {error}
        </p>
      )}

      {judge ? (
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
            onClick={playAgain}
            className="w-full rounded-lg bg-neutral-900 px-4 py-3 text-sm font-medium text-white hover:opacity-90 dark:bg-white dark:text-neutral-900"
          >
            Play again
          </button>
        </div>
      ) : (
        <div className="mt-8">
          <div className="flex items-center justify-between text-xs text-neutral-500">
            <span>
              Round {round + 1} / {ROUNDS}
            </span>
            <span>{correct} right</span>
          </div>

          <div className="mt-2 min-h-24 rounded-2xl border border-neutral-200 p-5 text-base dark:border-neutral-800">
            {loading ? (
              <span className="text-sm text-neutral-400">Loading…</span>
            ) : (
              <span className="italic">{scenario}</span>
            )}
          </div>

          {!revealed ? (
            <div className="mt-5">
              <div className="flex items-center justify-between text-xs text-neutral-500">
                <span>Fresh</span>
                <span className="text-lg font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                  {guess}/10
                </span>
                <span>Foul</span>
              </div>
              <input
                type="range"
                min={0}
                max={10}
                step={1}
                value={guess}
                onChange={(e) => setGuess(Number(e.target.value))}
                className="mt-2 w-full accent-neutral-900 dark:accent-white"
              />
              <button
                onClick={lockIn}
                disabled={loading}
                className="mt-4 w-full rounded-lg bg-neutral-900 px-4 py-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
              >
                Lock it in
              </button>
            </div>
          ) : (
            <div className="mt-5">
              <div
                className={`rounded-lg p-3 text-sm font-medium ${
                  off <= TOLERANCE
                    ? "bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-300"
                    : "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300"
                }`}
              >
                It was {actual}/10. You said {guess} — {off === 0 ? "spot on" : `off by ${off}`}.
              </div>
              <button
                onClick={next}
                disabled={loading}
                className="mt-3 w-full rounded-lg bg-neutral-900 px-4 py-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
              >
                {loading ? "…" : round + 1 < ROUNDS ? "Next" : "See the verdict"}
              </button>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
