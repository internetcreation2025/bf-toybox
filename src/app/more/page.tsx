import Link from "next/link";

// The "More" tab on phones — everything that isn't a primary bottom-tab.
const ITEMS = [
  { href: "/whats-on", label: "What's on your feet?", hint: "A quick check-in with the Decider" },
  { href: "/chronicle", label: "The Foot Chronicle", hint: "Your running record, day by day" },
  { href: "/stats", label: "Stats & achievements", hint: "Streaks, rarity, milestones" },
  { href: "/reports", label: "Reports", hint: "Habits drawn from what you've logged" },
  { href: "/archive", label: "Archive", hint: "Past verdicts and proofs" },
  { href: "/settings", label: "Settings", hint: "The Decider, notifications, your normality" },
];

export default function MorePage() {
  return (
    <main className="mx-auto max-w-2xl p-6 sm:p-8">
      <h1 className="text-2xl font-semibold tracking-tight">More</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Everything beyond the main tabs.
      </p>

      <div className="mt-6 space-y-3">
        {ITEMS.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className="flex items-center justify-between rounded-xl border border-neutral-200 p-4 transition-colors hover:border-neutral-400 active:bg-neutral-50 dark:border-neutral-800 dark:hover:border-neutral-600 dark:active:bg-neutral-900"
          >
            <span>
              <span className="font-medium">{it.label}</span>
              <span className="mt-0.5 block text-xs text-neutral-500">
                {it.hint}
              </span>
            </span>
            <span aria-hidden className="text-neutral-400">
              →
            </span>
          </Link>
        ))}
      </div>

      <form action="/auth/signout" method="post" className="mt-8">
        <button
          type="submit"
          className="w-full rounded-xl border border-neutral-300 p-3 text-sm font-medium transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
