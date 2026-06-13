import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, CLAUDE_MODEL } from "@/lib/anthropic";
import { DECIDER_VOICE, type PlanStep } from "@/lib/decider";

// Mike answers the Decider's questions about his day (e.g. a retrospective
// "what did you wear round town?"). She reads the day-plan + his answer and
// responds in character; the exchange is recorded so there's a real account of
// what actually went on his feet.
export async function POST(request: Request) {
  console.log("[plan/reply] start");

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

  const { challengeId, answer } = (await request.json()) as {
    challengeId?: string;
    answer?: string;
  };
  if (!challengeId || !answer?.trim()) {
    return NextResponse.json({ error: "challengeId and answer required" }, { status: 400 });
  }

  const { data: ch } = await supabase
    .from("bf_challenges")
    .select("plan_json, instruction")
    .eq("id", challengeId)
    .maybeSingle();
  // plan_json is the wrapper object { steps, before, carryover } — not a bare
  // array. Read steps defensively so a missing/odd shape can never crash here.
  const pj = (ch?.plan_json ?? null) as { steps?: PlanStep[] } | null;
  const steps = Array.isArray(pj?.steps) ? pj!.steps : [];
  const planText = steps
    .map((s) => `${s.when} — ${s.activity}: ${s.do}`)
    .join("\n")
    .slice(0, 2500);

  let reply = "";
  try {
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 220,
      messages: [
        {
          role: "user",
          content: `You are ${DECIDER_VOICE}

This is today's plan you laid out for Mike (some blocks may have been questions about what he actually did, since they'd already passed):
${planText || ch?.instruction || "(no plan on file)"}

Mike has just answered you:
"${answer.trim()}"

Respond in 1–3 sentences, in your voice, directly to Mike — acknowledge what he tells you he did with his feet/socks/footwear, react to it (pleased, teasing, or noting it for later), and only add a small follow-up if it genuinely fits. No preamble, no markdown.`,
        },
      ],
    });
    reply = msg.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
  } catch (err) {
    console.error("[plan/reply] anthropic error", err);
    const e = err as { status?: number; message?: string };
    const m =
      e.status === 401
        ? "Anthropic key rejected — check the ANTHROPIC_API_KEY in Vercel."
        : e.message || "AI request failed";
    return NextResponse.json({ error: m }, { status: 502 });
  }

  // Keep a record of what he reported (resilient — bf_memory has no kind
  // constraint). Stored as a note so it's part of the day's account.
  await supabase.from("bf_memory").insert({
    user_id: user.id,
    kind: "note",
    title: answer.trim().slice(0, 500),
    status: "done",
  });

  console.log("[plan/reply] done");
  return NextResponse.json({ reply });
}
