// Sock lifecycle — derive a sock's current life-stage from a single guessed
// "smell" number, itself worked out from its recorded wear since its last wash.
// One source of truth, shared by the catalogue, the Chronicle, and the Decider.

export type SockStage = "clean" | "light" | "ripe" | "overdue" | "retired";

export type SockWearState = {
  retired?: boolean | null;
  worn_hours?: number | null;
  played_count?: number | null;
  dried_count?: number | null;
  last_worn_at?: string | null;
};

// Guess a sock's current ripeness 0–10 from its wear since its last wash. A wash
// resets the wear counters, so a freshly washed sock reads 0. Sport sessions and
// wet-then-dried re-wears push it up faster than plain hours.
export function estimateSmell(
  hours: number,
  played: number,
  dried: number
): number {
  return Math.max(
    0,
    Math.min(10, Math.round(hours * 0.35 + played * 1.6 + dried * 1.9))
  );
}

export function smellOf(s: SockWearState): number {
  return estimateSmell(
    Number(s.worn_hours) || 0,
    Number(s.played_count) || 0,
    Number(s.dried_count) || 0
  );
}

// Overdue = the guessed smell is high enough that it genuinely wants a wash.
export const OVERDUE_SMELL = 7;
export function isOverdue(s: SockWearState): boolean {
  return smellOf(s) >= OVERDUE_SMELL;
}

// The stage now simply follows the guessed smell, so the label always agrees
// with the number shown beside it.
export function sockStage(s: SockWearState): SockStage {
  if (s.retired) return "retired";
  const hours = Number(s.worn_hours) || 0;
  const played = Number(s.played_count) || 0;
  const dried = Number(s.dried_count) || 0;
  if (hours === 0 && played === 0 && dried === 0) return "clean";
  const smell = estimateSmell(hours, played, dried);
  if (smell >= OVERDUE_SMELL) return "overdue";
  if (smell >= 4) return "ripe";
  return "light";
}

export const SOCK_STAGE_META: Record<
  SockStage,
  { label: string; hint: string; dot: string; classes: string }
> = {
  clean: {
    label: "Clean",
    hint: "Washed and unworn — fresh.",
    dot: "#22c55e",
    classes:
      "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400",
  },
  light: {
    label: "Lightly worn",
    hint: "A little wear on it, still fresh enough.",
    dot: "#3b82f6",
    classes: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400",
  },
  ripe: {
    label: "Getting ripe",
    hint: "Worn a fair bit — wash it soon.",
    dot: "#f59e0b",
    classes:
      "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400",
  },
  overdue: {
    label: "Overdue",
    hint: "Properly ripe — give it a wash (or a deliberate smell dare).",
    dot: "#ef4444",
    classes: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400",
  },
  retired: {
    label: "Retired",
    hint: "Out of rotation — the Decider won't pick it.",
    dot: "#6b7280",
    classes:
      "bg-neutral-200 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-500",
  },
};
