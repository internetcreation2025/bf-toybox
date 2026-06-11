"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { type Rarity } from "@/lib/decider";
import { VerdictCard } from "@/components/VerdictCard";

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

const SEAL_OPTIONS = [
  { label: "30 min", minutes: 30 },
  { label: "1 hour", minutes: 60 },
  { label: "2 hours", minutes: 120 },
];

export default function RollPage() {
  const supabase = createClient();
  const router = useRouter();
  const [step, setStep] = useState<"schedule" | "footwear" | "result">(
    "schedule"
  );

  // ── schedule (the next few hours, with the times the owner sets) ──
  const [slots, setSlots] = useState<Slot[]>([
    { label: "", activity: "", location: "" },
    { label: "", activity: "", location: "" },
  ]);

  const isComplete = (s: Slot) =>
    !!(s.label.trim() && s.activity.trim() && s.location.trim());
  const isBlank = (s: Slot) =>
    !s.label.trim() && !s.activity.trim() && !s.location.trim();

  const filledSlots = slots.filter(isComplete);
  // Every row must be either fully filled or completely empty, and we need at
  // least one filled row.
  const scheduleComplete =
    filledSlots.length >= 1 && slots.every((s) => isComplete(s) || isBlank(s));

  function updateSlot(i: number, patch: Partial<Slot>) {
    setSlots((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  }
  function addSlot() {
    setSlots((prev) => [...prev, { label: "", activity: "", location: "" }]);
  }
  function removeSlot(i: number) {
    setSlots((prev) => prev.filter((_, j) => j !== i));
  }

  // ── optional free-text context for the Decider ──
  const [context, setContext] = useState("");

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

  // ── mystery envelope ──
  const [seal, setSeal] = useState(false);
  const [sealMinutes, setSealMinutes] = useState(60);

  // ── rolling / result ──
  const [rolling, setRolling] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<RollResult | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [usedDouble, setUsedDouble] = useState(false);

  async function doRoll(opts: { doubleOrNothing?: boolean; sealMinutes?: number }) {
    setRolling(true);
    setError("");
    setRevealed(false);
    try {
      const res = await fetch("/api/roll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schedule: filledSlots,
          footwear: onHand,
          context: context.trim(),
          doubleOrNothing: !!opts.doubleOrNothing,
          sealMinutes: opts.sealMinutes ?? 0,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Roll failed");

      // Sealed → straight to the envelope; the verdict stays hidden until it
      // unlocks.
      if (json.sealed) {
        router.push(`/envelope/${json.id}`);
        return;
      }

      setResult(json as RollResult);
      setStep("result");
      if (opts.doubleOrNothing) setUsedDouble(true);
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
            The next few hours
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Block out your plans in your own words — set the time for each, what
            you&apos;re doing, and where.
          </p>

          <div className="mt-6 space-y-3">
            {slots.map((s, i) => (
              <div
                key={i}
                className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <input
                    value={s.label}
                    onChange={(e) => updateSlot(i, { label: e.target.value })}
                    placeholder="Time (e.g. 2–3pm, or now till 3)"
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950"
                  />
                  {slots.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeSlot(i)}
                      aria-label="Remove this block"
                      className="shrink-0 rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-500 hover:text-neutral-900 dark:border-neutral-700 dark:hover:text-neutral-100"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    value={s.activity}
                    onChange={(e) => updateSlot(i, { activity: e.target.value })}
                    placeholder="Activity (e.g. coffee)"
                    className="rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950"
                  />
                  <input
                    value={s.location}
                    onChange={(e) => updateSlot(i, { location: e.target.value })}
                    placeholder="Location (e.g. Starbucks, town)"
                    className="rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950"
                  />
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addSlot}
            className="mt-3 w-full rounded-lg border border-dashed border-neutral-300 px-4 py-2.5 text-sm text-neutral-500 hover:border-neutral-500 hover:text-neutral-900 dark:border-neutral-700 dark:hover:text-neutral-100"
          >
            + Add a time block
          </button>

          <button
            disabled={!scheduleComplete}
            onClick={() => setStep("footwear")}
            className="mt-4 w-full rounded-lg bg-neutral-900 px-4 py-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40 dark:bg-white dark:text-neutral-900"
          >
            {scheduleComplete ? "Next" : "Fill in at least one full block to continue"}
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

          {/* Free-text context for the Decider */}
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            rows={3}
            placeholder="Anything the Decider should know? (optional) — e.g. lost my padel game, feet been in trainers all day, still have the socks I kept from last week"
            className="mt-3 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm leading-relaxed outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950"
          />

          {/* Mystery envelope */}
          <div className="mt-5 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={seal}
                onChange={(e) => setSeal(e.target.checked)}
                className="mt-1 h-4 w-4 accent-neutral-900 dark:accent-white"
              />
              <span>
                <span className="text-sm font-medium">
                  Make it a timed mystery envelope
                </span>
                <span className="mt-0.5 block text-xs text-neutral-400">
                  Seal the verdict away — you won&apos;t see it until the timer
                  runs out.
                </span>
              </span>
            </label>

            {seal && (
              <div className="mt-3 flex flex-wrap gap-2 pl-7">
                {SEAL_OPTIONS.map((o) => (
                  <button
                    key={o.minutes}
                    onClick={() => setSealMinutes(o.minutes)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                      sealMinutes === o.minutes
                        ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                        : "border-neutral-300 dark:border-neutral-700"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>

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
              onClick={() => doRoll({ sealMinutes: seal ? sealMinutes : 0 })}
              className="flex-1 rounded-lg bg-neutral-900 px-4 py-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40 dark:bg-white dark:text-neutral-900"
            >
              {rolling
                ? seal
                  ? "Sealing…"
                  : "Rolling…"
                : seal
                ? "Seal my envelope"
                : "Roll my verdict"}
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
              {result.proofRequired && (
                <Link
                  href={`/proof/${result.id}`}
                  className="block w-full rounded-lg px-4 py-3 text-center text-sm font-semibold text-white hover:opacity-90"
                  style={{ backgroundColor: "#a855f7" }}
                >
                  Submit proof now →
                </Link>
              )}
              {!usedDouble && (
                <button
                  disabled={rolling}
                  onClick={() => doRoll({ doubleOrNothing: true })}
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
    <div className="mt-6">
      <VerdictCard data={result} />
    </div>
  );
}
