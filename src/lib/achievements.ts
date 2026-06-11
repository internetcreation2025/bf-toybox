import type { Rarity } from "@/lib/decider";

// Everything the achievement tests can look at. Computed once on the stats page.
export type PlayerStats = {
  totalRolls: number;
  daresIssued: number;
  wins: number; // verified proof dares
  fails: number; // failed proof dares
  epicsRolled: number;
  longestStreak: number;
  currentStreak: number;
  footwearCount: number;
  distinctLocations: number;
  bestMatch: number; // highest proof match confidence seen
  rarityCounts: Record<Rarity, number>;
  prepDone: number; // prep tasks the Decider set that you've paid off
  gamesReported: number; // game follow-ups answered
  losingStreak: number; // current consecutive disappointing games
};

export type Achievement = {
  key: string;
  label: string;
  description: string;
  test: (s: PlayerStats) => boolean;
};

export const ACHIEVEMENTS: Achievement[] = [
  {
    key: "getting-started",
    label: "Getting Started",
    description: "Roll your very first verdict.",
    test: (s) => s.totalRolls >= 1,
  },
  {
    key: "dared",
    label: "Dared",
    description: "Receive your first dare.",
    test: (s) => s.daresIssued >= 1,
  },
  {
    key: "deep-end",
    label: "Into the Deep End",
    description: "Roll an Epic.",
    test: (s) => s.epicsRolled >= 1,
  },
  {
    key: "proven",
    label: "Proven",
    description: "Pass your first photo-proof dare.",
    test: (s) => s.wins >= 1,
  },
  {
    key: "spotless",
    label: "Spotless",
    description: "Pass a proof at 95%+ foot match.",
    test: (s) => s.bestMatch >= 95,
  },
  {
    key: "on-a-roll",
    label: "On a Roll",
    description: "Reach a streak of 5.",
    test: (s) => s.longestStreak >= 5,
  },
  {
    key: "unshakable",
    label: "Unshakable",
    description: "Reach a streak of 10.",
    test: (s) => s.longestStreak >= 10,
  },
  {
    key: "collector",
    label: "Collector",
    description: "Catalogue 5 pairs of footwear.",
    test: (s) => s.footwearCount >= 5,
  },
  {
    key: "globetrotter",
    label: "Globetrotter",
    description: "Be set dares across 5 different locations.",
    test: (s) => s.distinctLocations >= 5,
  },
  {
    key: "veteran",
    label: "Veteran",
    description: "Reach 25 total rolls.",
    test: (s) => s.totalRolls >= 25,
  },
  {
    key: "forward-planner",
    label: "Forward Planner",
    description: "Pay off a prep task the Decider set in advance.",
    test: (s) => s.prepDone >= 1,
  },
  {
    key: "match-report",
    label: "Match Report",
    description: "Report back on a scheduled game.",
    test: (s) => s.gamesReported >= 1,
  },
  {
    key: "down-bad",
    label: "Down Bad",
    description: "Be on a losing streak of 3 — the Decider turns nasty.",
    test: (s) => s.losingStreak >= 3,
  },
];
