"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { RARITY_META, type Rarity } from "@/lib/decider";

type Slot = { label: string; activity: string; location: string };
type FootwearItem = { name: string; category: string };

type RollResult = {
  id: string;
  rarity: Rarity;
  verdictType: "wear" | "dare";
  instruction: string;
  flavor: string;
  proofRequired: boolean;
  proofElements: string[];
  today: string;
};

export default function RollPage() {
  const supabase = createClient();
  const [step, setStep] = useState<"schedule" | "footwear" | "result">(
    "schedule"
  );

  // ── schedule (next 4 hours, no gaps) ──
  const initialSlots = useMemo<Slot[]>(() => {
    const now = new Date();
    const fmt = (d: Date) =>
      d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return [0, 1, 2, 3].map((i) => {
      const start = new Date(now.getTime() + i * 3600000);
      const end = new Date(now.getTime() + (i + 1) * 3600000);
      return { label: `${fmt(start)} – ${fmt(end)}`, activity: "", location: "" };
    });
  }, []);
  const [slots, setSlots] = useState<Slot[]>(initialSlots);

  const scheduleComplete = slots.every(
    (s) => s.activity.trim() && s.location.trim()
  );

  // ── footwear on hand ──
  const [catalogue, setCatalogue] = useState<FootwearItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adHoc, setAdHoc] = useState("");

  const loadCatalogue = useCallback(async () => {
    const { data } = await supabase
      .from("bf_footwear")
      .select("name, category")
      .order("created_at", { ascending: false });
    setCatalogue((data ?? []) as FootwearItem[]);
  }, [supabase]);

  useEffect(() => {
    loadCatalogue();
  }, [loadCatalogue]);

  const onHand: FootwearItem[] = useMemo(() => {
    const fromCatalogue = catalogue.filter((c) => selected.has(c.name));
    const extras = adHoc
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name) => ({ name, category: "other" }));
    return [...fromCatalogue, ...extras];
  }, [catalogue, selected, adHoc]);

  // ── rolling / result ──
  const [rolling, setRolling] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<RollResult | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [usedDouble, setUsedDouble] = useState(false);

  async function doRoll(doubleOrNothing: boolean) {
    setRolling(true);
    setError("");
    setRevealed(false);
    try {
      const res = await fetch("/api/roll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schedule: slots,
          footwear: onHand,
          doubleOrNothing,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Roll failed");
      setResult(json as RollResult);
      setStep("result");
      if (doubleOrNothing) setUsedDouble(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Roll failed");
    } finally {
      setRolling(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl p-8">
      <Link
        href="/"
        className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
      >
        ← Dashboard
      </Link>

      {/* STEP 1 — schedule */}
      {step === "schedule" && (
        <div className="mt-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Your next 4 hours
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Every hour, no gaps. What are you doing, and where?
          </p>

          <div className="mt-6 space-y-3">
            {slots.map((s, i) => (
              <div
                key={i}
                className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"
              >
                <p className="mb-2 text-xs font-medium text-neutral-500">
                  {s.label}
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    value={s.activity}
                    onChange={(e) =>
                      setSlots((prev) =>
                        prev.map((p, j) =>
                          j === i ? { ...p, activity: e.target.value } : p
                        )
                      )
                    }
                    placeholder="Activity (e.g. coffee)"
                    className="rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950"
                  />
                  <input
                    value={s.location}
                    onChange={(e) =>
                      setSlots((prev) =>
                        prev.map((p, j) =>
                          j === i ? { ...p, location: e.target.value } : p
                        )
                      )
                    }
                    placeholder="Location (e.g. Starbucks, town)"
                    className="rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950"
                  />
                </div>
              </div>
            ))}
          </div>

          <button
            disabled={!scheduleComplete}
            onClick={() => setStep("footwear")}
            className="mt-4 w-full rounded-lg bg-neutral-900 px-4 py-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40 dark:bg-white dark:text-neutral-900"
          >
            {scheduleComplete ? "Next" : "Fill every hour to continue"}
          </button>
        </div>
      )}

      {/* STEP 2 — footwear on hand */}
      {step === "footwear" && (
        <div className="mt-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            What have you got on hand?
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Tap everything available to you right now.
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            {catalogue.map((c) => {
              const on = selected.has(c.name);
              return (
                <button
                  key={c.name}
                  onClick={() =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(c.name)) next.delete(c.name);
                      else next.add(c.name);
                      return next;
                    })
                  }
                  className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    on
                      ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                      : "border-neutral-300 dark:border-neutral-700"
                  }`}
                >
                  {c.name}
                </button>
              );
            })}
            {catalogue.length === 0 && (
              <p className="text-sm text-neutral-400">
                No catalogue yet — add items below, or in{" "}
                <Link href="/catalogue" className="underline">
                  Catalogue
                </Link>
                .
              </p>
            )}
          </div>

          <input
            value={adHoc}
            onChange={(e) => setAdHoc(e.target.value)}
            placeholder="Other items, comma-separated (e.g. bare feet, white socks)"
            className="mt-4 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950"
          />

          {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setStep("schedule")}
              className="rounded-lg border border-neutral-300 px-4 py-3 text-sm dark:border-neutral-700"
            >
              Back
            </button>
            <button
              disabled={onHand.length === 0 || rolling}
              onClick={() => doRoll(false)}
              className="flex-1 rounded-lg bg-neutral-900 px-4 py-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40 dark:bg-white dark:text-neutral-900"
            >
              {rolling ? "Rolling…" : "Roll my verdict"}
            </button>
          </div>
        </div>
      )}

      {/* STEP 3 — loot-box reveal */}
      {step === "result" && result && (
        <div className="mt-2">
          <RevealCard
            result={result}
            revealed={revealed}
            onReveal={() => setRevealed(true)}
          />

          {revealed && (
            <div className="mt-6 space-y-3">
              {!usedDouble && (
                <button
                  disabled={rolling}
                  onClick={() => doRoll(true)}
                  className="w-full rounded-lg border border-amber-400 px-4 py-3 text-sm font-medium text-amber-600 hover:bg-amber-50 disabled:opacity-40 dark:hover:bg-amber-950/30"
                >
                  {rolling ? "Re-rolling…" : "Double or nothing — spicier dare, bigger stakes"}
                </button>
              )}
              <Link
                href="/"
                className="block w-full rounded-lg bg-neutral-900 px-4 py-3 text-center text-sm font-medium text-white hover:opacity-90 dark:bg-white dark:text-neutral-900"
              >
                Done
              </Link>
              {error && <p className="text-sm text-red-500">{error}</p>}
            </div>
          )}
        </div>
      )}
    </main>
  );
}

function RevealCard({
  result,
  revealed,
  onReveal,
}: {
  result: RollResult;
  revealed: boolean;
  onReveal: () => void;
}) {
  const meta = RARITY_META[result.rarity];

  if (!revealed) {
    return (
      <button
        onClick={onReveal}
        className="mt-6 flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-neutral-300 bg-neutral-50 text-neutral-400 transition-transform hover:scale-[1.01] dark:border-neutral-700 dark:bg-neutral-950"
      >
        <span className="text-5xl font-bold">?</span>
        <span className="text-sm">Tap to reveal your verdict</span>
      </button>
    );
  }

  return (
    <div
      className="mt-6 overflow-hidden rounded-2xl border-2 p-6 shadow-lg transition-all"
      style={{ borderColor: meta.colour, boxShadow: `0 10px 40px -12px ${meta.colour}` }}
    >
      <div className="flex items-center justify-between">
        <span
          className="rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white"
          style={{ backgroundColor: meta.colour }}
        >
          {meta.label}
        </span>
        <span className="text-xs uppercase tracking-wide text-neutral-400">
          {result.verdictType === "dare" ? "Dare" : "Verdict"}
        </span>
      </div>

      {result.flavor && (
        <p className="mt-4 text-lg font-medium italic">{result.flavor}</p>
      )}
      <p className="mt-3 text-base">{result.instruction}</p>

      {result.proofRequired && (
        <div className="mt-5 rounded-xl bg-neutral-50 p-4 dark:bg-neutral-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Proof required
          </p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-neutral-600 dark:text-neutral-300">
            {result.proofElements.map((el, i) => (
              <li key={i}>{el}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-neutral-400">
            Photo proof &amp; foot-match verification arrive in the next phase.
          </p>
        </div>
      )}
    </div>
  );
}
