import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { RARITY_META, type Rarity } from "@/lib/decider";
import { DigestPanel } from "@/components/DigestPanel";

// The Chronicle — one chronological "life of your feet" feed, merging every
// recorded event (rolls, sock wears & washes, diary, gallery) into a single
// dated timeline, topped by the Archivist's latest weekly digest.

type Kind = "verdict" | "wear" | "wash" | "diary" | "bold";

type Event = {
  ts: string; // ISO timestamp it's sorted by
  kind: Kind;
  dot: string; // colour of the timeline dot
  title: string;
  detail?: string | null;
  href?: string;
};

const KIND_DOT: Record<Kind, string> = {
  verdict: "#a855f7",
  wear: "#3b82f6",
  wash: "#22c55e",
  diary: "#9ca3af",
  bold: "#f43f5e",
};

export default async function ChroniclePage() {
  const supabase = await createClient();

  const [
    { data: footwear },
    { data: challenges },
    { data: sockLog },
    { data: memory },
    { data: digest },
  ] = await Promise.all([
    supabase.from("bf_footwear").select("id, name, label"),
    supabase
      .from("bf_challenges")
      .select(
        "id, created_at, archived_at, rarity, verdict_type, instruction, status, proof_required_json"
      )
      .order("created_at", { ascending: false })
      .limit(80),
    supabase
      .from("bf_sock_log")
      .select("sock_id, event, hours, played, dried, smell, created_at")
      .order("created_at", { ascending: false })
      .limit(120),
    supabase
      .from("bf_memory")
      .select("id, kind, title, game_on, created_at")
      .in("kind", ["diary", "prep", "game"])
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("bf_memory")
      .select("title, game_on, created_at")
      .eq("kind", "digest")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const sockName = new Map<string, string>();
  for (const f of footwear ?? []) {
    const label = (f.label as string | null)?.trim();
    sockName.set(f.id as string, label ? `${f.name} (${label})` : (f.name as string));
  }

  const events: Event[] = [];

  // Rolls / verdicts
  for (const c of challenges ?? []) {
    const rarity = c.rarity as Rarity;
    const meta = RARITY_META[rarity];
    const isDare = c.verdict_type === "dare";
    const status = c.status as string;
    const verb =
      status === "verified"
        ? "Proof verified"
        : status === "failed"
        ? "Proof failed"
        : status === "completed"
        ? "Completed"
        : status === "cancelled"
        ? "Backed out of"
        : "Rolled";
    const hasProof = Array.isArray(c.proof_required_json);
    events.push({
      ts: (c.archived_at as string) || (c.created_at as string),
      kind: "verdict",
      dot: meta?.colour ?? KIND_DOT.verdict,
      title: `${verb} a ${meta?.label ?? rarity} ${isDare ? "dare" : "verdict"}`,
      detail: c.instruction as string,
      href: hasProof ? `/proof/${c.id}` : "/archive",
    });
  }

  // Sock wears & washes
  for (const r of sockLog ?? []) {
    const name = sockName.get(r.sock_id as string) ?? "a sock";
    if (r.event === "washed") {
      events.push({
        ts: r.created_at as string,
        kind: "wash",
        dot: KIND_DOT.wash,
        title: `Washed ${name}`,
      });
    } else if (r.event === "bold") {
      events.push({
        ts: r.created_at as string,
        kind: "bold",
        dot: KIND_DOT.bold,
        title: `Bold moment in ${name}`,
      });
    } else {
      const bits: string[] = [];
      if (r.hours) bits.push(`${r.hours}h`);
      if (r.played) bits.push("played sport");
      if (r.dried) bits.push("wet then dried");
      if (r.smell != null) bits.push(`~${r.smell}/10`);
      events.push({
        ts: r.created_at as string,
        kind: "wear",
        dot: KIND_DOT.wear,
        title: `Wore ${name}`,
        detail: bits.join(" · ") || null,
      });
    }
  }

  // Diary / prep / scheduled games
  for (const m of memory ?? []) {
    const k = m.kind as string;
    const word = k === "diary" ? "Diarised" : k === "prep" ? "Prep set" : "Game scheduled";
    events.push({
      ts: (m.created_at as string) || (m.game_on as string),
      kind: "diary",
      dot: KIND_DOT.diary,
      title: `${word}: ${m.title}`,
    });
  }

  events.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));

  // Streamline as it grows: the last RECENT_DAYS are shown in full; everything
  // older collapses into one condensed summary line per day, so the feed stays
  // readable no matter how long the record runs.
  const RECENT_DAYS = 14;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RECENT_DAYS);
  const cutoffDay = cutoff.toISOString().slice(0, 10);

  const recent = events.filter((e) => (e.ts || "").slice(0, 10) >= cutoffDay);
  const older = events
    .filter((e) => (e.ts || "").slice(0, 10) < cutoffDay)
    .slice(0, 400);

  // Full detail for recent days.
  const groups: Array<{ day: string; items: Event[] }> = [];
  for (const e of recent.slice(0, 150)) {
    const day = (e.ts || "").slice(0, 10);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(e);
    else groups.push({ day, items: [e] });
  }

  // Condensed: one summary per older day.
  const olderByDay: Array<{ day: string; summary: string }> = [];
  for (const e of older) {
    const day = (e.ts || "").slice(0, 10);
    const last = olderByDay[olderByDay.length - 1];
    if (!last || last.day !== day) olderByDay.push({ day, summary: "" });
  }
  const olderItems = new Map<string, Event[]>();
  for (const e of older) {
    const day = (e.ts || "").slice(0, 10);
    (olderItems.get(day) ?? olderItems.set(day, []).get(day)!).push(e);
  }
  for (const d of olderByDay) d.summary = summariseDay(olderItems.get(d.day) ?? []);

  const hasAnything = recent.length > 0 || older.length > 0;

  return (
    <main className="mx-auto max-w-2xl p-8">
      <Link
        href="/"
        className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
      >
        ← Dashboard
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        The Foot Chronicle
      </h1>
      <p className="mt-1 text-sm text-neutral-500">
        The running record of your feet — every wear, wash, verdict and dare, in
        order.
      </p>

      <div className="mt-6">
        <DigestPanel
          text={(digest?.title as string) ?? null}
          weekEnding={(digest?.game_on as string) ?? null}
        />
      </div>

      {!hasAnything && (
        <p className="mt-10 text-sm text-neutral-400">
          Nothing recorded yet. Roll a verdict, log some sock wear, or mark a
          bold moment, and it&apos;ll all show up here as one story.
        </p>
      )}

      <div className="mt-8 space-y-8">
        {groups.map((g) => (
          <section key={g.day}>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
              {fmtDay(g.day)}
            </h2>
            <ul className="mt-3 space-y-3 border-l border-neutral-200 pl-5 dark:border-neutral-800">
              {g.items.map((e, i) => {
                const body = (
                  <>
                    <span
                      className="absolute -left-[1.42rem] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-neutral-950"
                      style={{ backgroundColor: e.dot }}
                      aria-hidden
                    />
                    <p className="text-sm font-medium">{e.title}</p>
                    {e.detail && (
                      <p className="mt-0.5 text-sm text-neutral-500">
                        {e.detail}
                      </p>
                    )}
                  </>
                );
                return (
                  <li key={i} className="relative">
                    {e.href ? (
                      <Link
                        href={e.href}
                        className="block rounded-lg transition-colors hover:text-neutral-900 dark:hover:text-neutral-100"
                      >
                        {body}
                      </Link>
                    ) : (
                      body
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {olderByDay.length > 0 && (
        <section className="mt-10 border-t border-neutral-200 pt-8 dark:border-neutral-800">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Earlier
          </h2>
          <p className="mt-1 text-xs text-neutral-400">
            Older days, rolled up to keep the story readable.
          </p>
          <ul className="mt-4 space-y-2">
            {olderByDay.map((d) => (
              <li
                key={d.day}
                className="flex items-baseline justify-between gap-4 text-sm"
              >
                <span className="shrink-0 text-neutral-500">{fmtDay(d.day)}</span>
                <span className="min-w-0 text-right text-neutral-500">
                  {d.summary}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

// Condense a day's events into a short summary line for the "Earlier" tail.
function summariseDay(items: Event[]): string {
  const counts: Record<Kind, number> = {
    verdict: 0,
    wear: 0,
    wash: 0,
    diary: 0,
    bold: 0,
  };
  for (const e of items) counts[e.kind] += 1;
  const plural = (n: number, one: string, many = `${one}s`) =>
    `${n} ${n === 1 ? one : many}`;
  const parts: string[] = [];
  if (counts.verdict) parts.push(plural(counts.verdict, "verdict"));
  if (counts.bold) parts.push(plural(counts.bold, "bold moment"));
  if (counts.wear) parts.push(plural(counts.wear, "wear"));
  if (counts.wash) parts.push(plural(counts.wash, "wash", "washes"));
  if (counts.diary) parts.push(plural(counts.diary, "note"));
  return parts.join(" · ") || "—";
}

function fmtDay(iso: string): string {
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}
