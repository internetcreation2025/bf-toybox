// Sock lifecycle — derive a sock's current life-stage from its wear/wash state.
// One source of truth, shared by the catalogue, the Chronicle, and the Decider.

export type SockStage = "clean" | "resting" | "worn" | "overdue" | "retired";

export type SockWearState = {
  retired?: boolean | null;
  worn_hours?: number | null;
  played_count?: number | null;
  dried_count?: number | null;
  last_worn_at?: string | null;
};

// Past any one of these since its last wash, a sock counts as "ripe" — overdue.
export const OVERDUE_HOURS = 10;
export const OVERDUE_PLAYED = 2;
export const OVERDUE_DRIED = 1;
const RESTING_WINDOW_MS = 18 * 60 * 60 * 1000; // worn within ~18h = still resting

export function isOverdue(s: SockWearState): boolean {
  return (
    (Number(s.worn_hours) || 0) >= OVERDUE_HOURS ||
    (Number(s.played_count) || 0) >= OVERDUE_PLAYED ||
    (Number(s.dried_count) || 0) >= OVERDUE_DRIED
  );
}

export function sockStage(s: SockWearState): SockStage {
  if (s.retired) return "retired";
  const hours = Number(s.worn_hours) || 0;
  const played = Number(s.played_count) || 0;
  const dried = Number(s.dried_count) || 0;
  if (isOverdue(s)) return "overdue";
  if (hours === 0 && played === 0 && dried === 0) return "clean";
  if (s.last_worn_at) {
    const t = Date.parse(s.last_worn_at);
    if (!Number.isNaN(t) && Date.now() - t < RESTING_WINDOW_MS) return "resting";
  }
  return "worn";
}

export const SOCK_STAGE_META: Record<
  SockStage,
  { label: string; hint: string; dot: string; classes: string }
> = {
  clean: {
    label: "Clean",
    hint: "Fresh and ready to wear.",
    dot: "#22c55e",
    classes:
      "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400",
  },
  resting: {
    label: "Resting",
    hint: "Worn recently — giving it a breather before reuse.",
    dot: "#3b82f6",
    classes: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400",
  },
  worn: {
    label: "In rotation",
    hint: "Some wear on it, still good to go.",
    dot: "#9ca3af",
    classes:
      "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  },
  overdue: {
    label: "Overdue",
    hint: "Ripe — due a wash (or a deliberate smell dare).",
    dot: "#f59e0b",
    classes:
      "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400",
  },
  retired: {
    label: "Retired",
    hint: "Out of rotation — the Decider won't pick it.",
    dot: "#6b7280",
    classes:
      "bg-neutral-200 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-500",
  },
};
