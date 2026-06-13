"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { RARITY_META, type Rarity, type PlanStep } from "@/lib/decider";
import { estimateSmell } from "@/lib/socks";
import { PlanTimeline } from "@/components/PlanTimeline";

// A pair she spotted in his answer that he might want logged as a wear.
type WearSuggestion = { sockId: string; name: string; label: string | null; hours: number };

type WearItem = { id: string; name: string; category?: string };
type Slot = { label: string; activity: string; location: string };

export type ActiveChallenge = {
  id: string;
  rarity: Rarity;
  verdict_type: "wear" | "dare";
  instruction: string;
  flavor: string | null;
  proof_required_json: string[] | null;
  status: string;
};

type Ruling = { outcome: "upheld" | "harsher" | "mercy" | "error"; reply: string };

export function ActiveSession({ challenge }: { challenge: ActiveChallenge }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Negotiating with the Decider.
  const [showAppeal, setShowAppeal] = useState(false);
  const [plea, setPlea] = useState("");
  const [appealing, setAppealing] = useState(false);
  const [ruling, setRuling] = useState<Ruling | null>(null);

  // Wear-log panel — pick which socks you wore + log the hours, from the task.
  const [panelOpen, setPanelOpen] = useState(false);
  const [catalogSocks, setCatalogSocks] = useState<WearItem[]>([]);
  const [selectedSocks, setSelectedSocks] = useState<Set<string>>(new Set());
  const [hours, setHours] = useState("");
  const [played, setPlayed] = useState(false);
  const [dried, setDried] = useState(false);

  // The chronological plan + the schedule behind it, so it can be shown and
  // edited while the roll is in play.
  const [plan, setPlan] = useState<PlanStep[]>([]);
  const [before, setBefore] = useState("");
  const [carryover, setCarryover] = useState("");
  const [schedule, setSchedule] = useState<Slot[]>([]);
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [amending, setAmending] = useState(false);

  // Replying to the Decider's questions about the day (e.g. "what did you wear
  // round town?").
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyResponse, setReplyResponse] = useState("");
  // Pairs she spotted in his answer, offered as one-tap "log this wear" confirms.
  const [wearSuggestions, setWearSuggestions] = useState<WearSuggestion[]>([]);
  const [loggedSockIds, setLoggedSockIds] = useState<Set<string>>(new Set());
  const [loggingSockId, setLoggingSockId] = useState<string | null>(null);

  async function sendReply() {
    if (!replyText.trim()) return;
    setReplyBusy(true);
    setError("");
    try {
      const res = await fetch("/api/plan/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: challenge.id, answer: replyText.trim() }),
      });
      const raw = await res.text();
      const json = raw ? JSON.parse(raw) : {};
      if (!res.ok) throw new Error(json.error || "Couldn't send that.");
      setReplyResponse(json.reply || "Noted.");
      setWearSuggestions(Array.isArray(json.wear) ? json.wear : []);
      setLoggedSockIds(new Set());
      setReplyText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send that.");
    } finally {
      setReplyBusy(false);
    }
  }

  // Confirm a suggested wear — only now does it write to the sock's log, the
  // same way the catalogue's "Log wear" does (cumulative hours + audit row).
  async function confirmWear(s: WearSuggestion) {
    setLoggingSockId(s.sockId);
    setError("");
    try {
      const { data: row } = await supabase
        .from("bf_footwear")
        .select("worn_hours, played_count, dried_count")
        .eq("id", s.sockId)
        .maybeSingle();
      const nHours = (Number(row?.worn_hours) || 0) + s.hours;
      const played = Number(row?.played_count) || 0;
      const dried = Number(row?.dried_count) || 0;
      await supabase
        .from("bf_footwear")
        .update({ worn_hours: nHours, last_worn_at: new Date().toISOString() })
        .eq("id", s.sockId);
      // Audit trail (resilient — no-ops if bf_sock_log isn't there yet).
      await supabase.from("bf_sock_log").insert({
        sock_id: s.sockId,
        event: "worn",
        hours: s.hours,
        smell: estimateSmell(nHours, played, dried),
      });
      setLoggedSockIds((prev) => new Set(prev).add(s.sockId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't log that wear.");
    } finally {
      setLoggingSockId(null);
    }
  }

  const loadPlan = useCallback(async () => {
    // schedule_json always exists; plan_json may not pre-migration, so read it
    // defensively and fall back.
    const { data: schedRow } = await supabase
      .from("bf_challenges")
      .select("schedule_json")
      .eq("id", challenge.id)
      .maybeSingle();
    setSchedule(((schedRow?.schedule_json as Slot[] | null) ?? []).map((s) => ({
      label: s.label ?? "",
      activity: s.activity ?? "",
      location: s.location ?? "",
    })));

    const { data: planRow } = await supabase
      .from("bf_challenges")
      .select("plan_json")
      .eq("id", challenge.id)
      .maybeSingle();
    const pj = (planRow?.plan_json ?? null) as {
      steps?: PlanStep[];
      before?: string;
      carryover?: string;
    } | null;
    setPlan(Array.isArray(pj?.steps) ? pj!.steps : []);
    setBefore(typeof pj?.before === "string" ? pj.before : "");
    setCarryover(typeof pj?.carryover === "string" ? pj.carryover : "");
  }, [supabase, challenge.id]);

  useEffect(() => {
    loadPlan();
  }, [loadPlan]);

  function updateBlock(i: number, patch: Partial<Slot>) {
    setSchedule((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  }
  function addBlock() {
    setSchedule((prev) => [...prev, { label: "", activity: "", location: "" }]);
  }
  function removeBlock(i: number) {
    setSchedule((prev) => prev.filter((_, j) => j !== i));
  }

  async function submitAmend() {
    const cleaned = schedule.filter(
      (s) => s.label.trim() && s.activity.trim()
    );
    if (cleaned.length === 0) {
      setError("Keep at least one block with a time and activity.");
      return;
    }
    setAmending(true);
    setError("");
    try {
      const res = await fetch("/api/challenges/amend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: challenge.id, schedule: cleaned }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not update the plan");
      setPlan(Array.isArray(json.plan) ? json.plan : []);
      setBefore(json.before ?? "");
      setCarryover(json.carryover ?? "");
      setEditingSchedule(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the plan");
    } finally {
      setAmending(false);
    }
  }

  const meta = RARITY_META[challenge.rarity];
  const sealed = challenge.status === "sealed";
  const proofRequired = Array.isArray(challenge.proof_required_json);
  // The day in play can always be cancelled — that's how you start a fresh plan
  // (you can't overwrite a session, only cancel it and roll again).
  const canCancel = true;

  // "Mark as done": for a wear task (or one that assigned socks), open a panel
  // to log sock wear right here — pick the socks, pre-ticked with whatever the
  // Decider told you to wear. Pure dares with no socks just resolve.
  async function startDone() {
    setBusy(true);
    setError("");
    const [{ data: chData }, { data: sockData }] = await Promise.all([
      supabase
        .from("bf_challenges")
        .select("wear_json")
        .eq("id", challenge.id)
        .maybeSingle(),
      supabase
        .from("bf_footwear")
        .select("id, name")
        .eq("category", "socks")
        .order("created_at", { ascending: false }),
    ]);
    const wj = (chData?.wear_json ?? null) as { items?: WearItem[] } | null;
    const assignedSockIds = Array.isArray(wj?.items)
      ? wj!.items
          .filter((i) => i?.id && i.category === "socks")
          .map((i) => i.id)
      : [];
    const socks = (sockData ?? []) as WearItem[];
    const shouldLog =
      challenge.verdict_type === "wear" || assignedSockIds.length > 0;

    if (!shouldLog || socks.length === 0) {
      resolve("completed");
      return;
    }
    setCatalogSocks(socks);
    setSelectedSocks(new Set(assignedSockIds));
    setBusy(false);
    setPanelOpen(true);
  }

  async function resolve(
    outcome: "completed" | "cancelled",
    wearLog?: {
      hours: number;
      played: boolean;
      dried: boolean;
      sockIds: string[];
    }
  ) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/challenges/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: challenge.id, outcome, wearLog }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not update");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update");
      setBusy(false);
    }
  }

  async function sendAppeal() {
    if (!plea.trim()) return;
    setAppealing(true);
    setRuling(null);
    try {
      const res = await fetch("/api/challenges/appeal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: challenge.id, message: plea }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "The Decider didn't respond");
      setRuling({ outcome: json.outcome, reply: json.reply });
      setPlea("");
      router.refresh(); // pull the (possibly changed) verdict into the card
    } catch (e) {
      setRuling({
        outcome: "error",
        reply: e instanceof Error ? e.message : "Something went wrong.",
      });
    } finally {
      setAppealing(false);
    }
  }

  return (
    <div
      className="rounded-2xl border-2 p-5"
      style={{ borderColor: meta.colour }}
    >
      <div className="flex items-center gap-2">
        <span
          className="rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-white"
          style={{ backgroundColor: meta.colour }}
        >
          {sealed ? "Sealed" : meta.label}
        </span>
        <span className="text-xs uppercase tracking-wide text-muted">
          In play
        </span>
      </div>

      {sealed ? (
        <p className="mt-3 text-sm text-muted">
          A sealed envelope is waiting. Open it when its timer runs out.
        </p>
      ) : (
        <>
          {challenge.flavor && (
            <p className="mt-3 text-base font-medium italic">{challenge.flavor}</p>
          )}
          {plan.length > 0 ? (
            <div className="mt-3">
              <PlanTimeline
                plan={plan}
                before={before}
                carryover={carryover}
                accent={meta.colour}
              />
            </div>
          ) : (
            <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-200">
              {challenge.instruction}
            </p>
          )}

          {/* Answer the Decider's questions about the day */}
          {plan.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              {replyResponse && (
                <p className="mb-3 rounded-lg bg-surface-2 p-3 text-sm italic leading-relaxed text-neutral-700 dark:text-neutral-200">
                  {replyResponse}
                </p>
              )}
              {wearSuggestions.length > 0 && (
                <div className="mb-3 space-y-1.5">
                  {wearSuggestions.map((s) => {
                    const done = loggedSockIds.has(s.sockId);
                    const who = s.label ? `${s.label} — ${s.name}` : s.name;
                    return done ? (
                      <p
                        key={s.sockId}
                        className="flex items-center gap-1.5 rounded-lg bg-green-50 px-3 py-2 text-xs font-medium text-green-700 dark:bg-green-950/40 dark:text-green-400"
                      >
                        <span aria-hidden>✓</span> Logged {s.hours}h on {who}
                      </p>
                    ) : (
                      <button
                        key={s.sockId}
                        onClick={() => confirmWear(s)}
                        disabled={loggingSockId === s.sockId}
                        className="flex w-full items-center justify-between rounded-lg border border-line px-3 py-2 text-left text-xs transition-colors hover:border-accent disabled:opacity-50"
                      >
                        <span>
                          Log <strong>{s.hours}h</strong> on {who}?
                        </span>
                        <span aria-hidden className="text-accent">
                          {loggingSockId === s.sockId ? "…" : "Log →"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              {replyOpen ? (
                <div className="space-y-2">
                  <textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    rows={3}
                    placeholder="Answer her — e.g. “barefoot on the kitchen tiles, then my white S2 socks round town.”"
                    className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-accent dark:border-line dark:bg-neutral-950"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={sendReply}
                      disabled={replyBusy || !replyText.trim()}
                      className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
                    >
                      {replyBusy ? "Sending…" : "Send to the Decider"}
                    </button>
                    <button
                      onClick={() => setReplyOpen(false)}
                      className="rounded-lg px-3 py-1.5 text-xs text-muted hover:text-foreground"
                    >
                      Close
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setReplyOpen(true)}
                  className="text-sm font-medium text-muted hover:text-foreground"
                >
                  Tell her what happened →
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* Plans changed? Edit the schedule and the Decider re-plans the affected
          blocks only, keeping the rest. */}
      {!sealed && editingSchedule && (
        <div className="mt-4 space-y-2 rounded-xl border border-line p-3 dark:border-line">
          <p className="text-xs font-medium text-muted">
            Adjust today&apos;s blocks — the Decider will only re-do what changed.
          </p>
          {schedule.map((s, i) => (
            <div
              key={i}
              className="space-y-2 rounded-lg border border-line p-2.5 dark:border-line"
            >
              <div className="flex items-center gap-2">
                <input
                  value={s.label}
                  onChange={(e) => updateBlock(i, { label: e.target.value })}
                  placeholder="Time (e.g. 2–3:30pm)"
                  className="w-full rounded-lg border border-line px-2.5 py-1.5 text-sm font-medium outline-none focus:border-accent dark:border-line dark:bg-neutral-950"
                />
                <button
                  onClick={() => removeBlock(i)}
                  aria-label="Remove block"
                  className="shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted hover:text-red-600 dark:border-line"
                >
                  ✕
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input
                  value={s.activity}
                  onChange={(e) => updateBlock(i, { activity: e.target.value })}
                  placeholder="Activity"
                  className="rounded-lg border border-line px-2.5 py-1.5 text-sm outline-none focus:border-accent dark:border-line dark:bg-neutral-950"
                />
                <input
                  value={s.location}
                  onChange={(e) => updateBlock(i, { location: e.target.value })}
                  placeholder="Location (optional)"
                  className="rounded-lg border border-line px-2.5 py-1.5 text-sm outline-none focus:border-accent dark:border-line dark:bg-neutral-950"
                />
              </div>
            </div>
          ))}
          <button
            onClick={addBlock}
            className="w-full rounded-lg border border-dashed border-line px-3 py-1.5 text-xs text-muted hover:text-neutral-900 dark:border-line dark:hover:text-neutral-100"
          >
            + Add a block
          </button>
          <div className="flex gap-2 pt-1">
            <button
              onClick={submitAmend}
              disabled={amending}
              className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
            >
              {amending ? "Re-planning…" : "Update plan"}
            </button>
            <button
              onClick={() => {
                setEditingSchedule(false);
                loadPlan();
              }}
              className="rounded-lg px-3 py-1.5 text-xs text-muted hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Primary action */}
      <div className="mt-4">
        {sealed ? (
          <Link
            href={`/envelope/${challenge.id}`}
            className="inline-block rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:opacity-90 dark:bg-white dark:text-neutral-900"
          >
            Open envelope
          </Link>
        ) : proofRequired ? (
          <Link
            href={`/proof/${challenge.id}`}
            className="inline-block rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            style={{ backgroundColor: "#a855f7" }}
          >
            Submit proof
          </Link>
        ) : panelOpen ? null : (
          <button
            onClick={startDone}
            disabled={busy}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          >
            {busy ? "…" : "Mark as done"}
          </button>
        )}
      </div>

      {/* Log sock wear straight from the task — no catalogue trip. */}
      {panelOpen && (
        <div className="mt-3 space-y-2 rounded-xl border border-line p-3 dark:border-line">
          <p className="text-xs font-medium text-muted">
            Which socks did you wear?
          </p>
          <div className="flex flex-wrap gap-2">
            {catalogSocks.map((s) => {
              const on = selectedSocks.has(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() =>
                    setSelectedSocks((prev) => {
                      const next = new Set(prev);
                      if (next.has(s.id)) next.delete(s.id);
                      else next.add(s.id);
                      return next;
                    })
                  }
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    on
                      ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                      : "border-line"
                  }`}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
          <label className="block text-xs text-muted">
            Roughly how many hours?
            <input
              type="number"
              min={0}
              step={0.5}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              placeholder="e.g. 4"
              className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-accent dark:border-line dark:bg-neutral-950"
            />
          </label>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600 dark:text-neutral-300">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={played}
                onChange={(e) => setPlayed(e.target.checked)}
                className="h-3.5 w-3.5 accent-neutral-900 dark:accent-white"
              />
              Played sport in them
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={dried}
                onChange={(e) => setDried(e.target.checked)}
                className="h-3.5 w-3.5 accent-neutral-900 dark:accent-white"
              />
              Got wet then dried out
            </label>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() =>
                resolve("completed", {
                  hours: Number(hours) || 0,
                  played,
                  dried,
                  sockIds: [...selectedSocks],
                })
              }
              disabled={busy}
              className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
            >
              {busy ? "Saving…" : "Log & mark done"}
            </button>
            <button
              onClick={() =>
                resolve("completed", {
                  hours: 0,
                  played: false,
                  dried: false,
                  sockIds: [],
                })
              }
              disabled={busy}
              className="rounded-lg px-3 py-1.5 text-xs text-muted hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              Done, skip logging
            </button>
          </div>
        </div>
      )}

      {/* Secondary actions — tucked away as quiet links */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {!sealed && (
          <button
            onClick={() => setShowAppeal((v) => !v)}
            className="font-medium text-muted hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            {showAppeal ? "Close" : "Talk to the Decider"}
          </button>
        )}
        {!sealed && (
          <button
            onClick={() => setEditingSchedule((v) => !v)}
            className="text-muted hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            {editingSchedule ? "Close" : "Plans changed?"}
          </button>
        )}
        {canCancel ? (
          <button
            onClick={() => resolve("cancelled")}
            disabled={busy}
            className="text-muted hover:text-red-600 disabled:opacity-50"
          >
            Cancel
          </button>
        ) : (
          <span className="text-muted">
            Needs proof — stays until you submit.
          </span>
        )}
      </div>

      {/* Negotiate panel (inline, only when opened) */}
      {!sealed && showAppeal && (
        <div className="mt-3">
          <textarea
            value={plea}
            onChange={(e) => setPlea(e.target.value)}
            rows={2}
            placeholder="Reason with the Decider… (it may soften this, or make it worse)"
            className="w-full rounded-lg border border-line p-2.5 text-sm outline-none focus:border-accent dark:border-line dark:bg-neutral-950"
          />
          <button
            onClick={sendAppeal}
            disabled={appealing || !plea.trim()}
            className="mt-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          >
            {appealing ? "Putting your case…" : "Send"}
          </button>
        </div>
      )}

      {ruling && (
        <div
          className={`mt-3 rounded-xl p-3 text-sm ${
            ruling.outcome === "mercy"
              ? "bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-300"
              : ruling.outcome === "harsher"
              ? "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300"
              : "bg-neutral-50 text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
          }`}
        >
          {ruling.outcome !== "error" && (
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide">
              {ruling.outcome === "mercy"
                ? "Mercy"
                : ruling.outcome === "harsher"
                ? "Harsher"
                : "Upheld"}
            </p>
          )}
          <p className="italic">{ruling.reply}</p>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
    </div>
  );
}
