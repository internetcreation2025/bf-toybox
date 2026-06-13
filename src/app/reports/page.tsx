import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { estimateSmell, isOverdue } from "@/lib/socks";

type Footwear = {
  id: string;
  name: string;
  category: string;
  label: string | null;
  worn_hours: number | null;
  played_count: number | null;
  dried_count: number | null;
  sockless_count: number | null;
  wash_count: number | null;
  last_washed_at: string | null;
  retired: boolean | null;
};

type LogRow = {
  sock_id: string;
  event: string;
  note: string | null;
  created_at: string;
};

// Reports — the running picture the Stats page doesn't cover: real habits
// derived from logged wear, washes, and bold moments. Everything here is
// computed from data already captured; no new tables.
export default async function ReportsPage() {
  const supabase = await createClient();

  const [{ data: footwearData }, { data: challenges }, footChecks] =
    await Promise.all([
      supabase
        .from("bf_footwear")
        .select(
          "id, name, category, label, worn_hours, played_count, dried_count, sockless_count, wash_count, last_washed_at, retired"
        ),
      supabase.from("bf_challenges").select("status, schedule_json"),
      // Foot reveals (resilient — no-ops until bf_foot_checks exists).
      supabase
        .from("bf_foot_checks")
        .select("difficult, passed")
        .eq("passed", true),
    ]);

  const checks = (footChecks.data ?? []) as Array<{ difficult: boolean | null }>;
  const revealCount = checks.length;
  const trickyReveals = checks.filter((c) => c.difficult).length;

  // Sock log — tolerate the pre-migration schema that has no `note` column.
  let logs: LogRow[] = [];
  const withNote = await supabase
    .from("bf_sock_log")
    .select("sock_id, event, note, created_at")
    .order("created_at", { ascending: true });
  if (!withNote.error) {
    logs = (withNote.data ?? []) as LogRow[];
  } else {
    const { data } = await supabase
      .from("bf_sock_log")
      .select("sock_id, event, created_at")
      .order("created_at", { ascending: true });
    logs = ((data ?? []) as Omit<LogRow, "note">[]).map((l) => ({
      ...l,
      note: null,
    }));
  }

  const footwear = (footwearData ?? []) as Footwear[];
  const socks = footwear.filter((f) => f.category === "socks");
  const byId = new Map(footwear.map((f) => [f.id, f]));

  // --- Wears before a wash --------------------------------------------------
  // Walk each sock's log in order; count "worn" events in each run that ends
  // in a "washed". Average all completed runs.
  const completedRuns: number[] = [];
  const runBySock = new Map<string, number>();
  for (const l of logs) {
    if (l.event === "worn") {
      runBySock.set(l.sock_id, (runBySock.get(l.sock_id) ?? 0) + 1);
    } else if (l.event === "washed") {
      const run = runBySock.get(l.sock_id) ?? 0;
      if (run > 0) completedRuns.push(run);
      runBySock.set(l.sock_id, 0);
    }
  }
  const avgWearsBeforeWash = completedRuns.length
    ? completedRuns.reduce((a, b) => a + b, 0) / completedRuns.length
    : null;
  // Longest current unwashed run (socks worn but not yet washed).
  let longestOpenRun = 0;
  let longestOpenSock: string | null = null;
  for (const [id, run] of runBySock) {
    if (run > longestOpenRun) {
      longestOpenRun = run;
      longestOpenSock = byId.get(id)?.name ?? null;
    }
  }

  // --- Bold moments ---------------------------------------------------------
  const boldRows = logs
    .filter((l) => l.event === "bold")
    .reverse(); // newest first
  const boldCount = boldRows.length;

  // --- Bold outings (verified dares) ---------------------------------------
  const rows = (challenges ?? []) as Array<{
    status: string;
    schedule_json: Array<{ location?: string }> | null;
  }>;
  const verifiedDares = rows.filter((r) => r.status === "verified").length;
  const places = new Set<string>();
  for (const r of rows) {
    for (const s of r.schedule_json ?? []) {
      const loc = s.location?.trim().toLowerCase();
      if (loc) places.add(loc);
    }
  }

  // --- Most-worn pairs ------------------------------------------------------
  const mostWorn = [...footwear]
    .filter((f) => (f.worn_hours ?? 0) > 0 || (f.played_count ?? 0) > 0)
    .sort(
      (a, b) =>
        (b.worn_hours ?? 0) + (b.played_count ?? 0) * 4 -
        ((a.worn_hours ?? 0) + (a.played_count ?? 0) * 4)
    )
    .slice(0, 5);

  // --- Wash backlog ---------------------------------------------------------
  const overdueSocks = socks.filter(
    (s) =>
      !s.retired &&
      isOverdue({
        worn_hours: s.worn_hours,
        played_count: s.played_count,
        dried_count: s.dried_count,
      })
  );

  // --- Barefoot / bare-shod tally ------------------------------------------
  const bareShodTotal = footwear.reduce(
    (n, f) => n + (f.sockless_count ?? 0),
    0
  );

  return (
    <main className="mx-auto max-w-2xl p-8">
      <Link
        href="/"
        className="text-sm text-muted hover:text-neutral-900 dark:hover:text-neutral-100"
      >
        ← Dashboard
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Reports</h1>
      <p className="mt-1 text-sm text-muted">
        Your habits, drawn from what you&apos;ve logged — wear, washes, bold
        moments and the places you&apos;ve been.
      </p>

      {/* Headline tiles */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile
          label="Wears before a wash"
          value={
            avgWearsBeforeWash === null
              ? "—"
              : avgWearsBeforeWash.toFixed(1)
          }
          sub="average, across socks"
        />
        <Tile label="Bold moments" value={boldCount} sub="boundaries pushed" />
        <Tile label="Bold outings" value={verifiedDares} sub="dares verified" />
        <Tile
          label="Places been"
          value={places.size}
          sub="distinct locations"
        />
        <Tile
          label="Bare-shod"
          value={bareShodTotal}
          sub="shoes worn without socks"
        />
        <Tile
          label="Overdue socks"
          value={overdueSocks.length}
          sub="want a wash now"
        />
        <Tile
          label="Foot reveals"
          value={revealCount}
          sub="shown on demand"
        />
        <Tile
          label="Tricky reveals"
          value={trickyReveals}
          sub="pulled off somewhere awkward"
        />
      </div>

      {/* Wash discipline */}
      <Section title="Wash discipline">
        {avgWearsBeforeWash === null ? (
          <p className="text-sm text-muted">
            No wash cycles logged yet. Log wear and a wash on a sock to start
            building this.
          </p>
        ) : (
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            On average you get{" "}
            <strong>{avgWearsBeforeWash.toFixed(1)} wears</strong> out of a sock
            before washing it
            {longestOpenSock && longestOpenRun > 0 && (
              <>
                . Your longest current unwashed run is{" "}
                <strong>{longestOpenRun}</strong> on{" "}
                <strong>{longestOpenSock}</strong>
              </>
            )}
            .
          </p>
        )}
        {overdueSocks.length > 0 && (
          <p className="mt-2 text-sm text-red-500">
            Overdue right now: {overdueSocks.map((s) => s.label || s.name).join(", ")}.
          </p>
        )}
      </Section>

      {/* Most-worn */}
      <Section title="Most-worn pairs">
        {mostWorn.length === 0 ? (
          <p className="text-sm text-muted">Nothing logged yet.</p>
        ) : (
          <ul className="space-y-2">
            {mostWorn.map((f) => {
              const smell =
                f.category === "socks"
                  ? estimateSmell(
                      f.worn_hours ?? 0,
                      f.played_count ?? 0,
                      f.dried_count ?? 0
                    )
                  : null;
              return (
                <li
                  key={f.id}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="min-w-0 truncate">
                    {f.label ? `${f.label} · ` : ""}
                    {f.name}
                  </span>
                  <span className="shrink-0 text-muted">
                    {Math.round(f.worn_hours ?? 0)}h
                    {(f.played_count ?? 0) > 0 && ` · ${f.played_count} games`}
                    {smell !== null && ` · ~${smell}/10`}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* Bold moments */}
      <Section title="Recent bold moments">
        {boldRows.length === 0 ? (
          <p className="text-sm text-muted">
            None logged yet. Use “Bold moment” on a sock when you push a
            boundary in it.
          </p>
        ) : (
          <ul className="space-y-2">
            {boldRows.slice(0, 8).map((b, i) => (
              <li key={i} className="flex justify-between gap-3 text-sm">
                <span className="min-w-0">
                  {b.note ?? "A boundary pushed"}
                  {byId.get(b.sock_id) && (
                    <span className="text-muted">
                      {" "}
                      · {byId.get(b.sock_id)!.label || byId.get(b.sock_id)!.name}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-muted">
                  {b.created_at.slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </main>
  );
}

function Tile({
  label,
  value,
  sub,
}: {
  label: string;
  value: number | string;
  sub: string;
}) {
  return (
    <div className="rounded-xl border border-line p-4 dark:border-line">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-xs font-medium text-neutral-600 dark:text-neutral-300">
        {label}
      </div>
      <div className="text-xs text-muted">{sub}</div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}
