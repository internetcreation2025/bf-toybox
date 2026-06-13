import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ActiveSession, type ActiveChallenge } from "@/components/ActiveSession";
import { UpcomingDays } from "@/components/UpcomingDays";
import { GameFollowup, type GameMemory } from "@/components/GameFollowup";
import { PrepMemory, type PrepItem } from "@/components/PrepMemory";

// Middleware guarantees only the allowlisted owner reaches this page.
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const todayIso = new Date().toISOString().slice(0, 10);
  const [
    { data: streak },
    { data: active },
    { data: games },
    { data: preps },
    { data: diary },
  ] = await Promise.all([
      supabase
        .from("bf_streak")
        .select("current_streak, longest_streak, freeze_tokens")
        .maybeSingle(),
      supabase
        .from("bf_challenges")
        .select(
          "id, rarity, verdict_type, instruction, flavor, proof_required_json, status"
        )
        .in("status", ["issued", "sealed"])
        .order("created_at", { ascending: false }),
      supabase
        .from("bf_memory")
        .select("id, title, sport")
        .eq("kind", "game")
        .eq("status", "open")
        .lte("game_on", todayIso)
        .order("game_on", { ascending: true }),
      supabase
        .from("bf_memory")
        .select("id, title")
        .eq("kind", "prep")
        .eq("status", "open")
        .order("created_at", { ascending: true }),
      supabase
        .from("bf_memory")
        .select("id, title, game_on")
        .eq("kind", "diary")
        .eq("status", "open")
        .order("game_on", { ascending: true }),
    ]);

  const activeSessions = (active ?? []) as ActiveChallenge[];
  const gameFollowups = (games ?? []) as GameMemory[];
  const prepItems = (preps ?? []) as PrepItem[];
  const diaryItems = ((diary ?? []) as Array<{
    id: string;
    title: string;
    game_on: string | null;
  }>).map((d) => ({ id: d.id, title: d.title, due: d.game_on }));

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col p-6 sm:p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Sole Decider</h1>
          <p className="mt-1 text-sm text-muted">{user?.email}</p>
        </div>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            Sign out
          </button>
        </form>
      </header>

      <div className="mt-8 grid grid-cols-3 gap-3">
        <Stat label="Current streak" value={streak?.current_streak ?? 0} />
        <Stat label="Best streak" value={streak?.longest_streak ?? 0} />
        <Stat label="Freeze tokens" value={streak?.freeze_tokens ?? 0} />
      </div>

      <UpcomingDays />

      {gameFollowups.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            How did it go?
          </h2>
          <div className="mt-3 space-y-3">
            {gameFollowups.map((g) => (
              <GameFollowup key={g.id} memory={g} />
            ))}
          </div>
        </section>
      )}

      {activeSessions.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            In play
          </h2>
          <div className="mt-3 space-y-3">
            {activeSessions.map((c) => (
              <ActiveSession key={c.id} challenge={c} />
            ))}
          </div>
        </section>
      )}

      {diaryItems.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Your diary
          </h2>
          <p className="mt-1 text-xs text-muted">
            Dated tasks the Decider scheduled. Highlighted ones are due.
          </p>
          <div className="mt-3">
            <PrepMemory items={diaryItems} />
          </div>
        </section>
      )}

      {prepItems.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            The Decider remembers
          </h2>
          <p className="mt-1 text-xs text-muted">
            Prep tasks it set for the future. Mark done when you&apos;ve handled
            them.
          </p>
          <div className="mt-3">
            <PrepMemory items={prepItems} />
          </div>
        </section>
      )}

      <Link
        href="/roll?plan=1"
        className="mt-8 flex items-center justify-between rounded-2xl bg-accent p-5 text-on-accent shadow-sm transition-transform hover:-translate-y-0.5"
      >
        <span>
          <span className="text-base font-semibold">Plan my day</span>
          <span className="mt-0.5 block text-xs opacity-80">
            Pulls your calendar and lays out the day, foot by foot.
          </span>
        </span>
        <span aria-hidden className="text-lg">→</span>
      </Link>

      <Link
        href="/whats-on"
        className="mt-3 flex items-center justify-between rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-accent"
      >
        <span>
          <span className="font-medium">What&apos;s on your feet?</span>
          <span className="mt-0.5 block text-xs text-muted">
            A quick check-in with the Decider, wherever you are.
          </span>
        </span>
        <span aria-hidden className="text-muted">→</span>
      </Link>

      <p className="mt-10 text-center text-xs text-muted">
        Plan your day, complete it, keep the streak alive.
      </p>
      <p className="mt-2 text-center text-xs text-muted">
        <Link href="/vision-test" className="hover:text-foreground">
          Vision test
        </Link>
      </p>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 text-center">
      <div className="text-2xl font-semibold tabular-nums text-accent">
        {value}
      </div>
      <div className="mt-1 text-xs text-muted">{label}</div>
    </div>
  );
}
