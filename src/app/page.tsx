import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

// Middleware guarantees only the allowlisted owner reaches this page.
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: streak } = await supabase
    .from("bf_streak")
    .select("current_streak, longest_streak, freeze_tokens")
    .maybeSingle();

  const sections = [
    { href: "/roll", label: "Roll my next 4 hours", soon: false },
    { href: "/feet", label: "Teach it my feet", soon: false },
    { href: "/catalogue", label: "Footwear catalogue", soon: false },
    { href: "/settings", label: "The Decider (settings)", soon: false },
    { href: "/archive", label: "Archive", soon: true },
    { href: "/stats", label: "Stats & achievements", soon: true },
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

      <section className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {sections.map((s) =>
          s.soon ? (
            <div
              key={s.href}
              className="flex items-center justify-between rounded-xl border border-neutral-200 p-5 text-neutral-400 dark:border-neutral-800"
            >
              <span className="font-medium">{s.label}</span>
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500 dark:bg-neutral-900">
                soon
              </span>
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
