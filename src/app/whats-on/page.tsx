"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { resizeImage } from "@/lib/image";

type Item = {
  id: string;
  name: string;
  category: string;
  label: string | null;
  retired: boolean | null;
};

// One-tap "what's on your feet right now?" — where the Decider's random nudge
// lands. Mike answers in a tap or two; she replies in her voice.
export default function WhatsOnPage() {
  const supabase = createClient();
  const [items, setItems] = useState<Item[]>([]);
  const [onFeet, setOnFeet] = useState("");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");

  // "Show me your feet" proof flow.
  const [revealReq, setRevealReq] = useState<string | null>(null);
  const [revealBusy, setRevealBusy] = useState(false);
  const [revealResult, setRevealResult] = useState<string | null>(null);
  const [revealPassed, setRevealPassed] = useState<boolean | null>(null);
  const [difficult, setDifficult] = useState(false);
  const proofRef = useRef<HTMLInputElement>(null);

  // Spontaneous "surprise task" the Decider invents.
  const [task, setTask] = useState<string | null>(null);
  const [taskBusy, setTaskBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("bf_footwear")
      .select("id, name, category, label, retired")
      .order("category", { ascending: true });
    setItems(
      ((data ?? []) as Item[]).filter((i) => !i.retired)
    );
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function send() {
    if (!onFeet.trim()) return;
    setBusy(true);
    setError("");
    setReply("");
    try {
      const res = await fetch("/api/whats-on", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          onFeet: onFeet.trim(),
          location: location.trim(),
          nowLabel: nowLabel(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "She didn't answer — try again.");
      setReply(json.reply);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const nowLabel = () =>
    new Date().toLocaleString([], {
      weekday: "long",
      hour: "numeric",
      minute: "2-digit",
    });

  const askToSeeFeet = useCallback(async () => {
    setRevealBusy(true);
    setError("");
    setRevealResult(null);
    setRevealPassed(null);
    try {
      const res = await fetch("/api/feet/reveal-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location: location.trim(), nowLabel: nowLabel() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "She didn't answer — try again.");
      setRevealReq(json.request);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setRevealBusy(false);
    }
  }, [location]);

  const surpriseMe = useCallback(async () => {
    setTaskBusy(true);
    setError("");
    try {
      const res = await fetch("/api/whats-on/surprise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location: location.trim(), nowLabel: nowLabel() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "She didn't answer — try again.");
      setTask(json.task);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setTaskBusy(false);
    }
  }, [location]);

  // Nudges land here: ?reveal=1 → show-me-your-feet; ?task=1 → surprise task.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("reveal") === "1") askToSeeFeet();
    else if (p.get("task") === "1") surpriseMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitProof(file: File) {
    if (!revealReq) return;
    setRevealBusy(true);
    setError("");
    setRevealResult(null);
    try {
      const blob = await resizeImage(file);
      const dataUrl: string = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = rej;
        r.readAsDataURL(blob);
      });
      const res = await fetch("/api/feet/reveal-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: dataUrl,
          request: revealReq,
          location: location.trim(),
          difficult,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Couldn't check that — try again.");
      setRevealPassed(!!json.passed);
      setRevealResult(json.message || (json.passed ? "Good." : "Not quite."));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setRevealBusy(false);
    }
  }

  const quick = [
    "Barefoot",
    "Just socks",
    ...items
      .filter((i) => i.category === "socks")
      .map((i) => (i.label ? `${i.label} socks` : i.name)),
    ...items.filter((i) => i.category !== "socks").map((i) => i.name),
  ];

  return (
    <main className="mx-auto max-w-lg p-8">
      <Link
        href="/"
        className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
      >
        ← Dashboard
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        What&apos;s on your feet?
      </h1>
      <p className="mt-1 text-sm text-neutral-500">
        The Decider&apos;s asking. Tap what you&apos;ve got on (or type it), say
        where you are if you like, and she&apos;ll weigh in.
      </p>

      <input
        value={onFeet}
        onChange={(e) => setOnFeet(e.target.value)}
        placeholder="e.g. barefoot, white sports socks, black slides…"
        className="mt-6 w-full rounded-xl border border-neutral-300 px-4 py-3 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950"
      />

      <div className="mt-3 flex flex-wrap gap-2">
        {quick.slice(0, 14).map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => setOnFeet(q)}
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
              onFeet === q
                ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                : "border-neutral-300 hover:border-neutral-400 dark:border-neutral-700"
            }`}
          >
            {q}
          </button>
        ))}
      </div>

      <input
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        placeholder="Where are you? (optional — home, the gym, Edinburgh…)"
        className="mt-4 w-full rounded-xl border border-neutral-300 px-4 py-3 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950"
      />

      <button
        onClick={send}
        disabled={busy || !onFeet.trim()}
        className="mt-5 w-full rounded-xl bg-neutral-900 p-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
      >
        {busy ? "Asking her…" : "Tell the Decider"}
      </button>

      {error && <p className="mt-4 text-sm text-red-500">{error}</p>}

      {reply && (
        <div className="mt-6 rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
          <p className="whitespace-pre-line text-sm italic leading-relaxed text-neutral-700 dark:text-neutral-200">
            {reply}
          </p>
          <button
            onClick={() => {
              setReply("");
              setOnFeet("");
              setLocation("");
            }}
            className="mt-4 text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            Ask again
          </button>
        </div>
      )}

      {/* Surprise task — she invents something */}
      {task && (
        <div className="mt-6 rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
            She&apos;s decided
          </p>
          <p className="mt-2 text-sm italic leading-relaxed text-neutral-700 dark:text-neutral-200">
            {task}
          </p>
          <div className="mt-4 flex items-center gap-4 text-xs">
            <button
              onClick={() => setTask(null)}
              className="rounded-lg bg-neutral-900 px-3 py-1.5 font-medium text-white hover:opacity-90 dark:bg-white dark:text-neutral-900"
            >
              Done
            </button>
            <button
              onClick={surpriseMe}
              disabled={taskBusy}
              className="text-neutral-500 hover:text-neutral-900 disabled:opacity-50 dark:hover:text-neutral-100"
            >
              {taskBusy ? "Thinking…" : "Give me another"}
            </button>
          </div>
        </div>
      )}

      {/* Show me your feet — proof flow */}
      <section className="mt-8 border-t border-neutral-200 pt-6 dark:border-neutral-800">
        {!revealReq ? (
          <div className="flex flex-col gap-3">
            <button
              onClick={askToSeeFeet}
              disabled={revealBusy}
              className="text-left text-sm font-medium text-neutral-500 hover:text-neutral-900 disabled:opacity-50 dark:hover:text-neutral-100"
            >
              {revealBusy ? "She's deciding…" : "Dare me — have her ask to see my feet"}
            </button>
            <button
              onClick={surpriseMe}
              disabled={taskBusy}
              className="text-left text-sm font-medium text-neutral-500 hover:text-neutral-900 disabled:opacity-50 dark:hover:text-neutral-100"
            >
              {taskBusy ? "Thinking…" : "Surprise me — let her set anything"}
            </button>
          </div>
        ) : (
          <div className="rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
              She wants to see
            </p>
            <p className="mt-2 text-sm italic leading-relaxed text-neutral-700 dark:text-neutral-200">
              {revealReq}
            </p>

            {revealResult ? (
              <>
                <p
                  className={`mt-4 rounded-lg p-3 text-sm leading-relaxed ${
                    revealPassed
                      ? "bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400"
                      : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                  }`}
                >
                  {revealPassed && "✓ Logged. "}
                  {revealResult}
                </p>
                <button
                  onClick={() => {
                    setRevealReq(null);
                    setRevealResult(null);
                    setRevealPassed(null);
                    setDifficult(false);
                  }}
                  className="mt-3 text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
                >
                  Done
                </button>
              </>
            ) : (
              <>
                <label className="mt-4 flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
                  <input
                    type="checkbox"
                    checked={difficult}
                    onChange={(e) => setDifficult(e.target.checked)}
                    className="h-4 w-4 accent-neutral-900 dark:accent-white"
                  />
                  This was a tricky/risky place to get a foot out
                </label>
                <button
                  onClick={() => proofRef.current?.click()}
                  disabled={revealBusy}
                  className="mt-4 w-full rounded-xl bg-neutral-900 p-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
                >
                  {revealBusy ? "Checking…" : "Take the photo"}
                </button>
                <input
                  ref={proofRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) submitProof(f);
                    e.target.value = "";
                  }}
                />
                <button
                  onClick={() => setRevealReq(null)}
                  className="mt-3 block text-xs text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300"
                >
                  Not now
                </button>
              </>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
