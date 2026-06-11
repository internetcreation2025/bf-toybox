import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ActiveSession, type ActiveChallenge } from "@/components/ActiveSession";
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
    { data: gallery },
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
      supabase
        .from("bf_gallery")
        .select("id, prompt")
        .eq("status", "pending")
        .order("created_at", { ascending: true }),
    ]);

  const activeSessions = (active ?? []) as ActiveChallenge[];
  const gameFollowups = (games ?? []) as GameMemory[];
  const prepItems = (preps ?? []) as PrepItem[];
  const diaryItems = ((diary ?? []) as Array<{
    id: string;
    title: string;
    game_on: string | null;
  }>).map((d) => ({ id: d.id, title: d.title, due: d.game_on }));
  const galleryDemands = (gallery ?? []) as Array<{ id: string; prompt: string }>;

  // You can't start a new roll while a live (non-sealed) verdict is in play.
  const hasLiveSession = activeSessions.some((s) => s.status === "issued");

  const sections: Array<{
    href: string;
    label: string;
    disabled?: boolean;
    note?: string;
  }> = [
    {
      href: "/roll",
      label: "Roll my next 4 hours",
      disabled: hasLiveSession,
      note: "finish first",
    },
    { href: "/feet", label: "Teach it my feet" },
    { href: "/catalogue", label: "Footwear catalogue" },
    { href: "/settings", label: "The Decider (settings)" },
    { href: "/archive", label: "Archive" },
    { href: "/stats", label: "Stats & achievements" },
    { href: "/gallery", label: "The file" },
  ];

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sole Decider</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Signed in as {user?.email}
          </p>
        </div>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
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

      {gameFollowups.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
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
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            In play
          </h2>
          <div className="mt-3 space-y-3">
            {activeSessions.map((c) => (
              <ActiveSession key={c.id} challenge={c} />
            ))}
          </div>
        </section>
      )}

      {galleryDemands.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            The Roaster wants a shot
          </h2>
          <div className="mt-3 space-y-2">
            {galleryDemands.map((g) => (
              <Link
                key={g.id}
                href="/gallery"
                className="flex items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 transition-colors hover:border-amber-400 dark:border-amber-900/60 dark:bg-amber-950/30"
              >
                <span className="text-sm text-amber-900 dark:text-amber-200">
                  {g.prompt}
                </span>
                <span aria-hidden className="text-amber-700 dark:text-amber-300">
                  →
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {diaryItems.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Your diary
          </h2>
          <p className="mt-1 text-xs text-neutral-400">
            Dated tasks the Decider scheduled. Highlighted ones are due.
          </p>
          <div className="mt-3">
            <PrepMemory items={diaryItems} />
          </div>
        </section>
      )}

      {prepItems.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            The Decider remembers
          </h2>
          <p className="mt-1 text-xs text-neutral-400">
            Prep tasks it set for the future. Mark done when you&apos;ve handled
            them.
          </p>
          <div className="mt-3">
            <PrepMemory items={prepItems} />
          </div>
        </section>
      )}

      <section className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {sections.map((s) =>
          s.disabled ? (
            <div
              key={s.href}
              className="flex items-center justify-between rounded-xl border border-neutral-200 p-5 text-neutral-400 dark:border-neutral-800"
            >
              <span className="font-medium">{s.label}</span>
              {s.note && (
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500 dark:bg-neutral-900">
                  {s.note}
                </span>
              )}
            </div>
          ) : (
            <Link
              key={s.href}
              href={s.href}
              className="flex items-center justify-between rounded-xl border border-neutral-200 p-5 transition-colors hover:border-neutral-400 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
            >
              <span className="font-medium">{s.label}</span>
              <span aria-hidden>→</span>
            </Link>
          )
        )}
      </section>

      <p className="mt-10 text-center text-xs text-neutral-400">
        Roll for a verdict, complete it, keep the streak alive.
      </p>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-neutral-200 p-4 text-center dark:border-neutral-800">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-neutral-500">{label}</div>
    </div>
  );
}
