import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { RARITY_META, RARITY_ORDER, type Rarity } from "@/lib/decider";
import {
  ACHIEVEMENTS,
  type PlayerStats,
} from "@/lib/achievements";

type ChallengeRow = {
  rarity: Rarity;
  verdict_type: "wear" | "dare";
  status: string;
  verification_json: { match_confidence?: number } | null;
  schedule_json: Array<{ location?: string }> | null;
};

export default async function StatsPage() {
  const supabase = await createClient();

  const [
    { data: challenges },
    { data: streak },
    { count: footwearCount },
    { count: prepDone },
    { count: gamesReported },
  ] = await Promise.all([
    supabase
      .from("bf_challenges")
      .select("rarity, verdict_type, status, verification_json, schedule_json"),
    supabase
      .from("bf_streak")
      .select("current_streak, longest_streak, freeze_tokens, losing_streak")
      .maybeSingle(),
    supabase.from("bf_footwear").select("*", { count: "exact", head: true }),
    supabase
      .from("bf_memory")
      .select("*", { count: "exact", head: true })
      .eq("kind", "prep")
      .eq("status", "done"),
    supabase
      .from("bf_memory")
      .select("*", { count: "exact", head: true })
      .eq("kind", "game")
      .eq("status", "done"),
  ]);

  const rows = (challenges ?? []) as ChallengeRow[];

  const rarityCounts = { common: 0, uncommon: 0, rare: 0, epic: 0 } as Record<
    Rarity,
    number
  >;
  const locations = new Set<string>();
  let daresIssued = 0;
  let wins = 0;
  let fails = 0;
  let bestMatch = 0;

  for (const r of rows) {
    if (r.rarity in rarityCounts) rarityCounts[r.rarity] += 1;
    if (r.verdict_type === "dare") daresIssued += 1;
    if (r.status === "verified") wins += 1;
    if (r.status === "failed") fails += 1;
    const m = r.verification_json?.match_confidence ?? 0;
    if (m > bestMatch) bestMatch = m;
    for (const slot of r.schedule_json ?? []) {
      const loc = slot.location?.trim().toLowerCase();
      if (loc) locations.add(loc);
    }
  }

  const stats: PlayerStats = {
    totalRolls: rows.length,
    daresIssued,
    wins,
    fails,
    epicsRolled: rarityCounts.epic,
    longestStreak: streak?.longest_streak ?? 0,
    currentStreak: streak?.current_streak ?? 0,
    footwearCount: footwearCount ?? 0,
    distinctLocations: locations.size,
    bestMatch,
    rarityCounts,
    prepDone: prepDone ?? 0,
    gamesReported: gamesReported ?? 0,
    losingStreak: streak?.losing_streak ?? 0,
  };

  const resolved = wins + fails;
  const winRate = resolved ? Math.round((wins / resolved) * 100) : null;
  const maxRarity = Math.max(1, ...RARITY_ORDER.map((k) => rarityCounts[k]));
  const unlocked = ACHIEVEMENTS.filter((a) => a.test(stats));

  return (
    <main className="mx-auto max-w-2xl p-8">
      <Link
        href="/"
        className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
      >
        ← Dashboard
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        Stats &amp; achievements
      </h1>

      {/* Headline numbers */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total rolls" value={stats.totalRolls} />
        <Stat
          label="Win rate"
          value={winRate === null ? "—" : `${winRate}%`}
        />
        <Stat label="Current streak" value={stats.currentStreak} />
        <Stat label="Best streak" value={stats.longestStreak} />
      </div>

      {/* Rarity breakdown */}
      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Verdicts by rarity
        </h2>
        <div className="mt-4 space-y-3">
          {RARITY_ORDER.map((k) => {
            const meta = RARITY_META[k];
            const count = rarityCounts[k];
            return (
              <div key={k} className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-sm">{meta.label}</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-900">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${(count / maxRarity) * 100}%`,
                      backgroundColor: meta.colour,
                      minWidth: count ? "0.5rem" : 0,
                    }}
                  />
                </div>
                <span className="w-6 shrink-0 text-right text-sm tabular-nums text-neutral-500">
                  {count}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Achievements */}
      <section className="mt-10">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Achievements
          </h2>
          <span className="text-sm text-neutral-400">
            {unlocked.length}/{ACHIEVEMENTS.length}
          </span>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {ACHIEVEMENTS.map((a) => {
            const got = a.test(stats);
            return (
              <div
                key={a.key}
                className={`rounded-xl border p-4 transition-colors ${
                  got
                    ? "border-neutral-900 dark:border-white"
                    : "border-neutral-200 opacity-50 dark:border-neutral-800"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{a.label}</span>
                  <span className="text-xs uppercase tracking-wide text-neutral-400">
                    {got ? "Unlocked" : "Locked"}
                  </span>
                </div>
                <p className="mt-1 text-sm text-neutral-500">{a.description}</p>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-neutral-200 p-4 text-center dark:border-neutral-800">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-neutral-500">{label}</div>
    </div>
  );
}
