"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

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
      const nowLabel = new Date().toLocaleString([], {
        weekday: "long",
        hour: "numeric",
        minute: "2-digit",
      });
      const res = await fetch("/api/whats-on", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onFeet: onFeet.trim(), location: location.trim(), nowLabel }),
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
    </main>
  );
}
