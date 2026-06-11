import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, CLAUDE_MODEL } from "@/lib/anthropic";
import { PERSONAS, DEFAULT_PERSONA, isPersonaKey } from "@/lib/decider";

// Judges a finished round of the foot guessing game. A strong score earns a
// reward; a poor one earns a penance — including the "stare at a male foot for
// a set time" penance, drawn from the generated pool.
export async function POST(request: Request) {
  console.log("[guess/judge] start");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const allowed = process.env.ALLOWED_EMAIL?.toLowerCase();
  if (!user || (allowed && user.email?.toLowerCase() !== allowed)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { correct?: number; total?: number };
  const total = Math.max(1, Math.min(20, Number(body.total) || 5));
  const correct = Math.max(0, Math.min(total, Number(body.correct) || 0));
  const misses = total - correct;
  const reward = correct >= Math.ceil(total * 0.8); // 4/5 or better

  const { data: settings } = await supabase
    .from("bf_settings")
    .select("persona")
    .maybeSingle();
  const personaRaw = settings?.persona;
  const persona = isPersonaKey(personaRaw) ? personaRaw : DEFAULT_PERSONA;

  // For a penance, set up a "stare at a male foot" task from the pool.
  let stare: { url: string; seconds: number } | null = null;
  if (!reward) {
    const { data: males } = await supabase
      .from("bf_guess_pool")
      .select("image_path")
      .eq("gender", "male");
    const list = (males ?? []).filter((m) => m.image_path);
    if (list.length) {
      const pick = list[Math.floor(Math.random() * list.length)];
      const { data: signed } = await supabase.storage
        .from("bf-feet")
        .createSignedUrl(pick.image_path, 3600);
      const seconds = Math.max(60, Math.min(300, misses * 45));
      if (signed?.signedUrl) stare = { url: signed.signedUrl, seconds };
    }
  }

  const prompt = `You are "The Decider" in Mike's private footwear game. Write in this voice: ${PERSONAS[persona].voice}

Mike just played the Foot Guessing Game: shown ${total} bare feet, he had to call each one male or female. He got ${correct} of ${total} right.

${
  reward
    ? "He did well. Write a short reward — 1 to 2 sentences of warm, knowing praise in your voice."
    : `He did poorly. Mike hates the sight of other men's feet, so his penance is to STARE at a photo of a male foot for ${
        stare ? Math.round(stare.seconds / 60) : 1
      } minute(s). Write 1 to 2 sentences in your voice delivering this penance — make him squirm a little, no preamble.`
}

Return ONLY the message text — no JSON, no quotes, no preamble.`;

  let text = reward
    ? `Nicely done — ${correct} from ${total}.`
    : `${correct} from ${total}. Time to pay for it.`;
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
    console.error("[guess/judge] anthropic error", err);
    // Fall back to the default text — don't fail the round.
  }

  console.log("[guess/judge] done", { correct, total, reward });
  return NextResponse.json({
    outcome: reward ? "reward" : "penance",
    correct,
    total,
    text,
    stare,
  });
}
