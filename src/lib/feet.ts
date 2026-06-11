// The fixed set of reference angles the app learns the owner's feet from.
export const FOOT_ANGLES = [
  { key: "top_left", label: "Top of left foot" },
  { key: "top_right", label: "Top of right foot" },
  { key: "sole_left", label: "Sole of left foot" },
  { key: "sole_right", label: "Sole of right foot" },
  { key: "side_left", label: "Left foot — outer side" },
  { key: "side_right", label: "Right foot — outer side" },
  { key: "both_above", label: "Both feet from above" },
  { key: "heels", label: "Heels from behind" },
] as const;

export type FootAngleKey = (typeof FOOT_ANGLES)[number]["key"];

// Footwear catalogue categories.
export const FOOTWEAR_CATEGORIES = [
  "barefoot",
  "socks",
  "slides",
  "flip_flops",
  "trainers",
  "boots",
  "dress_shoes",
  "sandals",
  "other",
] as const;

export type FootwearCategory = (typeof FOOTWEAR_CATEGORIES)[number];

export function prettyCategory(c: string): string {
  return c.replace(/_/g, " ");
}
