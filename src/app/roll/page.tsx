"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { type Rarity, type PlanStep } from "@/lib/decider";
import { buildDaySchedule, type DayEvent } from "@/lib/day-schedule";
import { VerdictCard } from "@/components/VerdictCard";

type Slot = { label: string; activity: string; location: string };
type FootwearItem = {
  id?: string;
  name: string;
  category: string;
  label?: string | null;
};

// Pseudo-option for the "wearing right now" list — selecting it means sockless.
const BARE = "Bare feet";

type RollResult = {
  id: string;
  rarity: Rarity;
  verdictType: "wear" | "dare";
  instruction: string;
  flavor: string;
  plan?: PlanStep[];
  before?: string;
  carryover?: string;
  proofRequired: boolean;
  proofElements: string[];
  today: string;
};

export default function RollPage() {
  const supabase = createClient();
  const router = useRouter();
  const [step, setStep] = useState<"schedule" | "footwear" | "result">(
    "schedule"
  );

  // ── when & where ──
  const todayIso = useMemo(() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }, []);
  const [date, setDate] = useState(todayIso);
  const [weatherLocation, setWeatherLocation] = useState("Dunfermline, Fife");

  // ── schedule (the next few hours, with the times the owner sets) ──
  const [slots, setSlots] = useState<Slot[]>([
    { label: "", activity: "", location: "" },
    { label: "", activity: "", location: "" },
  ]);

  // A block just needs a time and an activity — location is optional (the
  // Decider falls back to your home base). Calendar events rarely carry a place.
  const isComplete = (s: Slot) => !!(s.label.trim() && s.activity.trim());
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

  // ── Whole-day plan from the connected (offline) Google Calendar ──
  const [gcalBusy, setGcalBusy] = useState(false);
  const [gcalMsg, setGcalMsg] = useState("");
  const [wholeDay, setWholeDay] = useState(false);

  async function planWholeDay() {
    setGcalBusy(true);
    setGcalMsg("");
    try {
      const timeMin = new Date(`${date}T00:00:00`).toISOString();
      const timeMax = new Date(`${date}T23:59:59`).toISOString();
      const res = await fetch(
        `/api/calendar/today?timeMin=${timeMin}&timeMax=${timeMax}`
      );
      const json = await res.json();
      if (!json.connected) {
        setGcalMsg(
          "Your Google Calendar isn't connected yet — connect it in Settings."
        );
        return;
      }
      const events = (json.events ?? []) as DayEvent[];
      setSlots(buildDaySchedule(events));
      setWholeDay(true);
      // For a whole day at home base, everything he owns is on hand.
      setSelected(new Set(catalogue.map((c) => c.name)));
      setGcalMsg(
        `Built your day from ${events.length} calendar event(s) — review, then continue.`
      );
    } catch (e) {
      setGcalMsg(e instanceof Error ? e.message : "Couldn't read your calendar.");
    } finally {
      setGcalBusy(false);
    }
  }

  // ── optional free-text context for the Decider ──
  const [context, setContext] = useState("");

  // ── footwear on hand ──
  const [catalogue, setCatalogue] = useState<FootwearItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adHoc, setAdHoc] = useState("");

  const [catalogueLoaded, setCatalogueLoaded] = useState(false);
  const loadCatalogue = useCallback(async () => {
    const { data } = await supabase
      .from("bf_footwear")
      .select("id, name, category, label, retired")
      .order("category", { ascending: true });
    const items = ((data ?? []) as Array<FootwearItem & { retired?: boolean }>)
      .filter((c) => !c.retired);
    setCatalogue(items);
    // At home, assume everything is to hand — pre-select the lot. He can deselect
    // anything he genuinely hasn't got with him (e.g. when out).
    setSelected(new Set(items.map((c) => c.name)));
    setCatalogueLoaded(true);
  }, [supabase]);

  // ── what he's already wearing right now (optional) ──
  const [wearingSel, setWearingSel] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadCatalogue();
  }, [loadCatalogue]);

  // Arriving from the home "Plan my day" button (?plan=1): pull the calendar
  // automatically once the catalogue is loaded, so the day is laid out in one
  // tap. Re-pulls fresh every time the page loads.
  const autoPulledRef = useRef(false);
  useEffect(() => {
    if (autoPulledRef.current || !catalogueLoaded) return;
    const wantPlan =
      new URLSearchParams(window.location.search).get("plan") === "1";
    if (wantPlan) {
      autoPulledRef.current = true;
      planWholeDay();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogueLoaded]);

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

  async function doRoll(opts: { doubleOrNothing?: boolean }) {
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
          wearing: {
            names: [...wearingSel].filter((n) => n !== BARE),
            sockless: wearingSel.has(BARE),
          },
          context: context.trim(),
          date,
          weatherLocation: weatherLocation.trim() || undefined,
          doubleOrNothing: !!opts.doubleOrNothing,
          nowLabel: new Date().toLocaleString([], {
            weekday: "long",
            hour: "numeric",
            minute: "2-digit",
          }),
          clientToday: todayIso,
          wholeDay,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Roll failed");

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
        className="text-sm text-muted hover:text-neutral-900 dark:hover:text-neutral-100"
      >
        ← Dashboard
      </Link>

      {/* STEP 1 — schedule */}
      {step === "schedule" && (
        <div className="mt-2">
          <h1 className="text-2xl font-semibold tracking-tight">Your day</h1>
          <p className="mt-1 text-sm text-muted">
            Pull your whole day from your calendar in one tap, or block it out by
            hand — set the time, what you&apos;re doing, and where.
          </p>

          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium text-muted">Date</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-accent dark:border-line dark:bg-neutral-950"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-muted">
                Your area, for weather (optional)
              </span>
              <input
                value={weatherLocation}
                onChange={(e) => setWeatherLocation(e.target.value)}
                placeholder="e.g. Reading, UK"
                className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-accent dark:border-line dark:bg-neutral-950"
              />
            </label>
          </div>

          <button
            type="button"
            onClick={planWholeDay}
            disabled={gcalBusy}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-line px-4 py-2.5 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50 dark:border-line dark:hover:bg-neutral-900"
          >
            {gcalBusy ? "Reading your calendar…" : "Plan my whole day from calendar"}
          </button>
          {gcalMsg && (
            <p className="mt-2 text-xs text-muted">{gcalMsg}</p>
          )}

          <div className="mt-4 space-y-3">
            {slots.map((s, i) => (
              <div
                key={i}
                className="rounded-xl border border-line p-4 dark:border-line"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <input
                    value={s.label}
                    onChange={(e) => updateSlot(i, { label: e.target.value })}
                    placeholder="Time (e.g. 2–3pm, or now till 3)"
                    className="w-full rounded-lg border border-line px-3 py-2 text-sm font-medium outline-none focus:border-accent dark:border-line dark:bg-neutral-950"
                  />
                  {slots.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeSlot(i)}
                      aria-label="Remove this block"
                      className="shrink-0 rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-neutral-900 dark:border-line dark:hover:text-neutral-100"
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
                    className="rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-accent dark:border-line dark:bg-neutral-950"
                  />
                  <input
                    value={s.location}
                    onChange={(e) => updateSlot(i, { location: e.target.value })}
                    placeholder="Location (optional — e.g. Starbucks, town)"
                    className="rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-accent dark:border-line dark:bg-neutral-950"
                  />
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addSlot}
            className="mt-3 w-full rounded-lg border border-dashed border-line px-4 py-2.5 text-sm text-muted hover:border-neutral-500 hover:text-neutral-900 dark:border-line dark:hover:text-neutral-100"
          >
            + Add a time block
          </button>

          <button
            disabled={!scheduleComplete}
            onClick={() => setStep("footwear")}
            className="mt-4 w-full rounded-lg bg-accent px-4 py-3 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-40"
          >
            {scheduleComplete ? "Next" : "Add a block with a time and activity to continue"}
          </button>
        </div>
      )}

      {/* STEP 2 — footwear on hand */}
      {step === "footwear" && (
        <div className="mt-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            What&apos;s on hand?
          </h1>
          <p className="mt-1 text-sm text-muted">
            At home, everything&apos;s assumed to hand — just untick anything you
            haven&apos;t got with you.
          </p>

          {catalogue.length === 0 ? (
            <p className="mt-6 text-sm text-muted">
              No catalogue yet — add your socks and shoes in{" "}
              <Link href="/catalogue" className="underline">
                Wardrobe
              </Link>
              , or list ad-hoc items below.
            </p>
          ) : (
            <div className="mt-6 space-y-5">
              {(["socks", "shoes"] as const).map((group) => {
                const list =
                  group === "socks"
                    ? catalogue.filter((c) => c.category === "socks")
                    : catalogue.filter((c) => c.category !== "socks");
                if (list.length === 0) return null;
                return (
                  <div key={group}>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                      {group === "socks" ? "Socks" : "Shoes & other"}
                    </p>
                    <div className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line">
                      {list.map((c) => {
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
                            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-surface-2"
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              {c.category === "socks" && c.label && (
                                <span className="shrink-0 rounded-md bg-foreground px-1.5 py-0.5 text-xs font-semibold text-background">
                                  {c.label}
                                </span>
                              )}
                              <span className="truncate">{c.name}</span>
                            </span>
                            <span
                              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${
                                on
                                  ? "border-accent bg-accent text-on-accent"
                                  : "border-line text-transparent"
                              }`}
                              aria-hidden
                            >
                              ✓
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <input
            value={adHoc}
            onChange={(e) => setAdHoc(e.target.value)}
            placeholder="Other items, comma-separated (e.g. old flip-flops)"
            className="mt-4 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-accent dark:border-line dark:bg-neutral-950"
          />

          {/* What he's wearing right now (optional) */}
          {catalogue.length > 0 && (
            <div className="mt-4 rounded-xl border border-line p-4 dark:border-line">
              <p className="text-sm font-medium">Wearing right now? (optional)</p>
              <p className="mt-0.5 text-xs text-muted">
                So the Decider knows what&apos;s already on — she might tell you to
                keep them, change, or escalate.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {[BARE, ...catalogue.map((c) => c.label && c.category === "socks" ? `${c.label} · ${c.name}` : c.name)].map(
                  (display, idx) => {
                    // The selection value is the plain name (or BARE); the label
                    // is only for display.
                    const value =
                      idx === 0 ? BARE : catalogue[idx - 1].name;
                    const on = wearingSel.has(value);
                    return (
                      <button
                        key={value}
                        onClick={() =>
                          setWearingSel((prev) => {
                            const next = new Set(prev);
                            if (next.has(value)) next.delete(value);
                            else next.add(value);
                            return next;
                          })
                        }
                        className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                          on
                            ? "border-accent bg-accent text-on-accent"
                            : "border-line hover:border-accent"
                        }`}
                      >
                        {display}
                      </button>
                    );
                  }
                )}
              </div>
            </div>
          )}

          {/* Free-text context for the Decider */}
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            rows={3}
            placeholder="Anything the Decider should know? (optional) — e.g. lost my padel game, feet been in trainers all day, still have the socks I kept from last week"
            className="mt-3 w-full rounded-lg border border-line px-3 py-2 text-sm leading-relaxed outline-none focus:border-accent dark:border-line dark:bg-neutral-950"
          />

          {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setStep("schedule")}
              className="rounded-lg border border-line px-4 py-3 text-sm dark:border-line"
            >
              Back
            </button>
            <button
              disabled={onHand.length === 0 || rolling}
              onClick={() => doRoll({})}
              className="flex-1 rounded-lg bg-accent px-4 py-3 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-40"
            >
              {rolling ? "Setting your day…" : "Set my day"}
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
                  className="block w-full rounded-lg px-4 py-3 text-center text-sm font-semibold text-on-accent hover:opacity-90"
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
                className="block w-full rounded-lg bg-accent px-4 py-3 text-center text-sm font-medium text-on-accent hover:opacity-90"
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
        className="mt-6 flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line bg-neutral-50 text-muted transition-transform hover:scale-[1.01] dark:border-line dark:bg-neutral-950"
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
