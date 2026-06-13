import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, CLAUDE_MODEL } from "@/lib/anthropic";
import {
  DECIDER_VOICE,
  DEFAULT_BASE_INSTRUCTIONS,
  normalityBlock,
} from "@/lib/decider";

// A spontaneous nudge that ISN'T tied to "what's on your feet" or "show me" —
// the Decider invents one small task of her own choosing, any kind: a smell,
// a sensation, a texture, something with his socks or footwear, a tiny bit of
// foot care, a small bold moment. Inventive, brief, and within his boundaries.
export async function POST(request: Request) {
  console.log("[whats-on/surprise] start");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const allowed = process.env.ALLOWED_EMAIL?.toLowerCase();
  if (!user || (allowed && user.email?.toLowerCase() !== allowed)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "Server is missing ANTHROPIC_API_KEY — set it in Vercel and redeploy." },
      { status: 500 }
    );
  }

  const { location, nowLabel } = (await request.json().catch(() => ({}))) as {
    location?: string;
    nowLabel?: string;
  };

  const { data: settings } = await supabase
    .from("bf_settings")
    .select("normality, base_instructions, custom_instructions")
    .maybeSingle();

  // A little real context: what footwear/socks he owns, and any ripe socks.
  const { data: footwear } = await supabase
    .from("bf_footwear")
    .select("name, category, label, retired")
    .eq("retired", false)
    .limit(40);
  const haveSocks = (footwear ?? []).some((f) => f.category === "socks");
  const haveShoes = (footwear ?? []).some((f) => f.category !== "socks");

  const base = settings?.base_instructions?.trim() || DEFAULT_BASE_INSTRUCTIONS;

  let task = "";
  try {
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: `You are ${DECIDER_VOICE}

${base}

${normalityBlock(settings?.normality)}
${settings?.custom_instructions?.trim() ? `\nMike's extra notes to you:\n${settings.custom_instructions.trim()}\n` : ""}
On a whim, out of nowhere, you want to nudge Mike to do ONE small thing right now — your choice, anything in your world: a smell, a sensation, a texture, something with his socks or footwear${
            haveSocks || haveShoes ? " (he has both socks and shoes catalogued)" : ""
          }, a tiny bit of foot care, or a small bold moment. NOT the usual "what's on your feet" or "show me your feet" — surprise him with something fresh and specific. Keep it quick and doable wherever he is, and only push a boundary if nobody who knows him is around.

${nowLabel ? `It's ${nowLabel}.` : ""}${location ? ` He's at: ${location}.` : ""}

Give ONE instruction in your voice — one or two sentences, no preamble, no markdown.`,
        },
      ],
    });
    task = msg.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim()
      .slice(0, 400);
  } catch (err) {
    console.error("[whats-on/surprise] anthropic error", err);
    const e = err as { status?: number; message?: string };
    const m =
      e.status === 401
        ? "Anthropic key rejected — check the ANTHROPIC_API_KEY in Vercel."
        : e.message || "AI request failed";
    return NextResponse.json({ error: m }, { status: 502 });
  }

  if (!task) task = "Slip a shoe off and take a slow breath of it — tell me how it's wearing.";
  console.log("[whats-on/surprise] done");
  return NextResponse.json({ task });
}
