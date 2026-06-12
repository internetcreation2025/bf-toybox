import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, CLAUDE_MODEL } from "@/lib/anthropic";
import { PERSONAS, DEFAULT_PERSONA, isPersonaKey } from "@/lib/decider";
import { estimateSmell } from "@/lib/socks";

// Smell-o-Meter: invents a sock's wear history, narrates it in the Decider's
// voice WITHOUT stating a number, and returns the "true" smell index (0-10) the
// player has to guess. The index uses the same shared model as the catalogue.

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const allowed = process.env.ALLOWED_EMAIL?.toLowerCase();
  if (!user || (allowed && user.email?.toLowerCase() !== allowed)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Bias toward no-sport scenarios so the guessable range isn't pinned at 10
  // (sport weighs heavily in the shared model).
  const hours = Math.floor(Math.random() * 19); // 0-18h since last wash
  const played = Math.random() < 0.5 ? 0 : Math.random() < 0.7 ? 1 : 2;
  const dried = Math.random() < 0.7 ? 0 : 1; // wet-then-dried re-wear
  const actual = estimateSmell(hours, played, dried);

  const { data: settings } = await supabase
    .from("bf_settings")
    .select("persona")
    .maybeSingle();
  const persona = isPersonaKey(settings?.persona)
    ? settings!.persona
    : DEFAULT_PERSONA;

  const prompt = `You are "The Decider" in Mike's private footwear game. Write in this voice: ${PERSONAS[persona].voice}

Describe ONE pair of his socks and their history, in 1-2 vivid sentences, so he can judge how ripe they are. Use these facts and weave them in naturally:
- worn ${hours} hour(s) since their last wash
- played sport (padel/racketball) in them ${played} time(s)
- got soaked and dried out, then re-worn, ${dried} time(s)

Do NOT state any number or smell rating — that's what he has to guess. No preamble, just the description.`;

  let scenario = `Worn ${hours}h since washing, ${played} game(s) played in them, dried and re-worn ${dried}×.`;
  try {
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 160,
      messages: [{ role: "user", content: prompt }],
    });
    const t = msg.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    if (t) scenario = t.slice(0, 400);
  } catch (err) {
    console.error("[games/smell] anthropic error", err);
  }

  return NextResponse.json({ scenario, actual });
}
