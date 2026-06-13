import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, CLAUDE_MODEL } from "@/lib/anthropic";
import {
  DECIDER_VOICE,
  DEFAULT_BASE_INSTRUCTIONS,
  normalityBlock,
} from "@/lib/decider";
import { getValidAccessToken } from "@/lib/google-oauth";
import { listEvents } from "@/lib/gcal-server";

// The one-tap "what's on your feet right now?" check-in. Mike says what he has
// on (and optionally where he is); the Decider responds in her voice — usually
// a quick, knowing remark, sometimes a tiny on-the-spot suggestion or dare,
// always reasoning from his normality, the time, and where he is.
export async function POST(request: Request) {
  console.log("[whats-on] start");

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

  const { onFeet, location, nowLabel } = (await request.json()) as {
    onFeet?: string;
    location?: string;
    nowLabel?: string;
  };
  if (!onFeet?.trim()) {
    return NextResponse.json({ error: "Tell me what's on your feet." }, { status: 400 });
  }

  const { data: settings } = await supabase
    .from("bf_settings")
    .select("normality, base_instructions, custom_instructions")
    .maybeSingle();

  // Light context: where today's calendar says he is right now, if connected.
  let nearby = "";
  try {
    const token = await getValidAccessToken(supabase, user.id);
    if (token) {
      const now = new Date();
      const start = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
      const end = new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString();
      const events = await listEvents(token, start, end);
      if (events.length) {
        nearby = events
          .map(
            (e) =>
              `${e.summary}${e.location ? ` @ ${e.location}` : ""}`
          )
          .join("; ");
      }
    }
  } catch {
    // Calendar is best-effort context only.
  }

  const base = settings?.base_instructions?.trim() || DEFAULT_BASE_INSTRUCTIONS;

  let reply = "";
  try {
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 220,
      messages: [
        {
          role: "user",
          content: `You are ${DECIDER_VOICE}

${base}

${normalityBlock(settings?.normality)}
${settings?.custom_instructions?.trim() ? `\nMike's extra notes to you:\n${settings.custom_instructions.trim()}\n` : ""}
You've just asked Mike, out of the blue, "what's on your feet right now?" — and he's answered.

Right now: ${nowLabel || "an unspecified time"}.
On his feet: ${onFeet.trim()}.
Where he is: ${location?.trim() || "he didn't say"}.
${nearby ? `His calendar around now: ${nearby}.` : ""}

Respond in 1–3 sentences, in your voice, directly to Mike. React to what he's wearing and where he is. Mostly just a knowing, specific remark; only sometimes a small on-the-spot suggestion or a tiny dare — and only push a boundary if nobody who knows him is around. No preamble, no markdown.`,
        },
      ],
    });
    reply = msg.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
  } catch (err) {
    console.error("[whats-on] anthropic error", err);
    const e = err as { status?: number; message?: string };
    const m =
      e.status === 401
        ? "Anthropic key rejected — check the ANTHROPIC_API_KEY in Vercel."
        : e.message || "AI request failed";
    return NextResponse.json({ error: m }, { status: 502 });
  }

  console.log("[whats-on] done");
  return NextResponse.json({ reply });
}
