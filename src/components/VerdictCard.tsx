import { RARITY_META, type Rarity, type PlanStep } from "@/lib/decider";
import { PlanTimeline } from "@/components/PlanTimeline";

export type VerdictData = {
  rarity: Rarity;
  verdictType: "wear" | "dare";
  instruction: string;
  flavor: string | null;
  proofRequired: boolean;
  proofElements: string[];
  plan?: PlanStep[] | null;
  before?: string | null;
  carryover?: string | null;
};

// The revealed verdict: a rarity-coloured card with the flavour line, then the
// chronological day-plan (each block, with what to wear and what to do straight
// after), and — for proof dares — the checklist of what the photo must show.
// Falls back to a single instruction line for older verdicts with no plan.
// Shared by the roll loot-box and the mystery-envelope reveal.
export function VerdictCard({ data }: { data: VerdictData }) {
  const meta = RARITY_META[data.rarity];
  const plan = data.plan ?? [];
  const hasPlan = plan.length > 0;

  return (
    <div
      className="overflow-hidden rounded-2xl border-2 p-6 shadow-lg"
      style={{ borderColor: meta.colour, boxShadow: `0 10px 40px -12px ${meta.colour}` }}
    >
      <div className="flex items-center justify-between">
        <span
          className="rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white"
          style={{ backgroundColor: meta.colour }}
        >
          {meta.label}
        </span>
        <span className="text-xs uppercase tracking-wide text-neutral-400">
          {data.verdictType === "dare" ? "Dare" : "Verdict"}
        </span>
      </div>

      {data.flavor && (
        <p className="mt-4 text-lg font-medium italic">{data.flavor}</p>
      )}

      {hasPlan ? (
        <div className="mt-5">
          <PlanTimeline
            plan={plan}
            before={data.before}
            carryover={data.carryover}
            accent={meta.colour}
          />
        </div>
      ) : (
        <p className="mt-3 text-base">{data.instruction}</p>
      )}

      {data.proofRequired && (
        <div className="mt-5 rounded-xl bg-neutral-50 p-4 dark:bg-neutral-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Proof required
          </p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-neutral-600 dark:text-neutral-300">
            {data.proofElements.map((el, i) => (
              <li key={i}>{el}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-neutral-400">
            Submit your photo proof to lock in the win.
          </p>
        </div>
      )}
    </div>
  );
}
