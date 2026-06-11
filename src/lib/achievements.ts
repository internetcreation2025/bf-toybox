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
];
