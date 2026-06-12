import Link from "next/link";

const GAMES: Array<{
  href: string;
  title: string;
  blurb: string;
  ready: boolean;
}> = [
  {
    href: "/guess",
    title: "Male or Female",
    blurb: "Close-up of a bare foot — call it. AI-generated.",
    ready: true,
  },
  {
    href: "/games/smell",
    title: "Smell-o-Meter",
    blurb: "Guess how ripe a sock is from its history, 0–10.",
    ready: true,
  },
  {
    href: "/games/footwear",
    title: "Name that footwear",
    blurb: "A tight crop of one of your own shoes — which is it?",
    ready: true,
  },
  {
    href: "/games/match",
    title: "Spot your own foot",
    blurb: "Four extreme close-ups, one is yours. Pick it.",
    ready: true,
  },
];

export default function GamesPage() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <Link
        href="/"
        className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
      >
        ← Dashboard
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Games</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Little tests the Decider can set you. Win for a reward, slip up for a
        penance.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {GAMES.map((g) =>
          g.ready ? (
            <Link
              key={g.title}
              href={g.href}
              className="rounded-xl border border-neutral-200 p-5 transition-colors hover:border-neutral-400 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
            >
              <p className="font-medium">{g.title}</p>
              <p className="mt-1 text-sm text-neutral-500">{g.blurb}</p>
            </Link>
          ) : (
            <div
              key={g.title}
              className="rounded-xl border border-dashed border-neutral-200 p-5 text-neutral-400 dark:border-neutral-800"
            >
              <p className="font-medium">{g.title}</p>
              <p className="mt-1 text-sm">{g.blurb}</p>
            </div>
          )
        )}
      </div>
    </main>
  );
}
