import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, CLAUDE_MODEL } from "@/lib/anthropic";
import { PERSONAS, DEFAULT_PERSONA, isPersonaKey } from "@/lib/decider";

// Generic judge for the lighter games (Smell-o-Meter, Name That Footwear).
// A strong score earns persona praise; a poor one a verbal penance. The
// image-based foot games handle their own (stare) penance separately.
const GAME_LABELS: Record<string, string> = {
  smell: "the Smell-o-Meter — judging how ripe a sock is from its history",
  footwear: "Name That Footwear — identifying his own shoes from a tight close-up",
  match: "Spot Your Own Foot — picking his real foot out of AI strangers",
  part: "Name the Part — identifying which labelled spot of his own foot a close-up shows",
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const allowed = process.env.ALLOWED_EMAIL?.toLowerCase();
  if (!user || (allowed && user.email?.toLowerCase() !== allowed)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    game?: string;
    correct?: number;
    total?: number;
  };
  const total = Math.max(1, Math.min(20, Number(body.total) || 5));
  const correct = Math.max(0, Math.min(total, Number(body.correct) || 0));
  const reward = correct >= Math.ceil(total * 0.8);
  const label = GAME_LABELS[body.game ?? ""] ?? "one of his footwear games";

  const { data: settings } = await supabase
    .from("bf_settings")
    .select("persona")
    .maybeSingle();
  const persona = isPersonaKey(settings?.persona)
    ? settings!.persona
    : DEFAULT_PERSONA;

  const prompt = `You are "The Decider" in Mike's private footwear game. Write in this voice: ${PERSONAS[persona].voice}

Mike just played ${label}. He scored ${correct} out of ${total}.

${
  reward
    ? "He did well — write 1 to 2 sentences of warm, knowing praise in your voice."
    : "He did poorly — write 1 to 2 sentences of penance in your voice: a small, doable forfeit (no photos needed), make him squirm a little."
}

Return ONLY the message text — no JSON, no quotes, no preamble.`;

  let text = reward
    ? `Sharp — ${correct} from ${total}.`
    : `${correct} from ${total}. Not your finest.`;
  try {
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });
    const t = msg.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    if (t) text = t.slice(0, 500);
  } catch (err) {
    console.error("[games/judge] anthropic error", err);
  }

  return NextResponse.json({
    outcome: reward ? "reward" : "penance",
    correct,
    total,
    text,
  });
}
