import type { PlanStep } from "@/lib/decider";

// Presentational chronological day-plan: before-prep, each block as a timeline
// step (with what to do straight after), and the day-long carry-over. Shared by
// the revealed VerdictCard and the in-play card. No client hooks — safe in both.
export function PlanTimeline({
  plan,
  before,
  carryover,
  accent,
}: {
  plan: PlanStep[];
  before?: string | null;
  carryover?: string | null;
  accent: string; // rarity colour for the headline dot/tag
}) {
  if (!plan.length) return null;
  return (
    <div className="space-y-4">
      {before && (
        <div className="rounded-xl bg-neutral-50 p-4 dark:bg-neutral-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Before you start
          </p>
          <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-200">
            {before}
          </p>
        </div>
      )}

      <ol className="space-y-3 border-l-2 border-line pl-5 dark:border-line">
        {plan.map((s, i) => (
          <li key={i} className="relative">
            <span
              className="absolute -left-[1.65rem] top-1 h-3 w-3 rounded-full ring-2 ring-white dark:ring-neutral-900"
              style={{ backgroundColor: s.headline ? accent : "#9ca3af" }}
              aria-hidden
            />
            <div className="flex flex-wrap items-baseline gap-x-2">
              {s.when && (
                <span className="text-sm font-semibold tabular-nums">{s.when}</span>
              )}
              {s.activity && (
                <span className="text-sm text-muted">{s.activity}</span>
              )}
              {s.headline && (
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
                  style={{ backgroundColor: accent }}
                >
                  Headline
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-neutral-800 dark:text-neutral-100">
              {s.do}
            </p>
            {s.after && (
              <p className="mt-1 text-sm text-muted">
                <span className="font-medium">After:</span> {s.after}
              </p>
            )}
          </li>
        ))}
      </ol>

      {carryover && (
        <div className="rounded-xl bg-neutral-50 p-4 dark:bg-neutral-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Through the day
          </p>
          <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-200">
            {carryover}
          </p>
        </div>
      )}
    </div>
  );
}
