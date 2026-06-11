// ─── Rarity tiers ────────────────────────────────────────────────────────────
export type Rarity = "common" | "uncommon" | "rare" | "epic";

export const RARITY_ORDER: Rarity[] = ["common", "uncommon", "rare", "epic"];

export const RARITY_META: Record<
  Rarity,
  { label: string; colour: string }
> = {
  common: { label: "Common", colour: "#9ca3af" },
  uncommon: { label: "Uncommon", colour: "#22c55e" },
  rare: { label: "Rare", colour: "#3b82f6" },
  epic: { label: "Epic", colour: "#a855f7" },
};

// Default "Balanced" odds (the owner can retune these later in Settings).
export const DEFAULT_WEIGHTS: Record<Rarity, number> = {
  common: 48,
  uncommon: 30,
  rare: 16,
  epic: 6,
};

export function rollRarity(
  weights: Record<Rarity, number>,
  forceSpicy = false
): Rarity {
  // Double-or-nothing forces the high tiers.
  const w = forceSpicy
    ? { common: 0, uncommon: 0, rare: 35, epic: 65 }
    : weights;
  const total = RARITY_ORDER.reduce((a, k) => a + (w[k] || 0), 0) || 1;
  let r = Math.random() * total;
  for (const k of RARITY_ORDER) {
    r -= w[k] || 0;
    if (r <= 0) return k;
  }
  return "common";
}

export function rarityBrief(r: Rarity): {
  verdictType: "wear" | "dare";
  proofRequired: boolean;
  guide: string;
} {
  switch (r) {
    case "common":
      return {
        verdictType: "wear",
        proofRequired: false,
        guide:
          "Normal, comfortable footwear suited to the schedule — e.g. shoes/trainers WITH socks. Sensible and unremarkable.",
      };
    case "uncommon":
      return {
        verdictType: "wear",
        proofRequired: false,
        guide:
          "A mild twist using what they have — e.g. socks only (no shoes), shoes with NO socks, or slides. No photo proof.",
      };
    case "rare":
      return {
        verdictType: "dare",
        proofRequired: false,
        guide:
          "A light dare for a short window — e.g. flip-flops out and about, or barefoot for about an hour somewhere reasonable. Honour system, no photo.",
      };
    case "epic":
      return {
        verdictType: "dare",
        proofRequired: true,
        guide:
          "A bold, context-aware barefoot dare tied to a specific moment in their schedule, requiring PHOTO PROOF. The proof must include the tops of the bare feet, a clear object proving the schedule location/context, and today's date written on the foot in pen.",
      };
  }
}

// ─── Persona (quick voice selector) ──────────────────────────────────────────
export const PERSONAS = {
  butler: {
    label: "The Butler",
    voice:
      "a deadpan, impeccably polite English butler — dry, formal, unflappable, faintly amused; addresses the player as 'sir'.",
  },
  gremlin: {
    label: "The Gremlin",
    voice:
      "a chaotic little gremlin — gleeful, mischievous, goading, high-energy, lives for a dare.",
  },
  sergeant: {
    label: "The Sergeant",
    voice:
      "a barking drill sergeant — curt, intense, occasional ALL-CAPS, no-nonsense commands.",
  },
} as const;

export type PersonaKey = keyof typeof PERSONAS;
export const DEFAULT_PERSONA: PersonaKey = "butler";

export function isPersonaKey(v: unknown): v is PersonaKey {
  return typeof v === "string" && v in PERSONAS;
}

// ─── Editable agent instructions ─────────────────────────────────────────────
export const DEFAULT_BASE_INSTRUCTIONS = `You are "The Decider", game master of a private, single-player footwear game for the owner.

Your job: given the owner's next few hours and the footwear they have on hand, issue ONE verdict about what to put on (or take off) their feet. Sometimes a sensible recommendation, sometimes a playful dare. Each turn you are given a "rarity" tier that sets how adventurous to be — honour it.

Principles:
- Tie the verdict to the owner's ACTUAL schedule and the footwear they ACTUALLY have. Be specific, never generic.
- Keep it light, fun, and a little cheeky — it should give them a kick.
- Dares must be doable and in good taste: nothing unsafe, nothing genuinely unhygienic, nothing involving other people without consent.
- Be concise: one clear instruction plus one punchy line of flavour.`;

// Base (owner-edited or default) + the owner's extra instructions, which take
// priority and may override or omit parts of the base.
export function composeInstructions(
  base: string | null | undefined,
  custom: string | null | undefined
): string {
  let out = (base && base.trim()) || DEFAULT_BASE_INSTRUCTIONS;
  if (custom && custom.trim()) {
    out += `\n\nADDITIONAL OWNER INSTRUCTIONS (these take priority — follow them, and omit anything they tell you to omit):\n${custom.trim()}`;
  }
  return out;
}
