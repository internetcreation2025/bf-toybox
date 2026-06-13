import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, CLAUDE_MODEL } from "@/lib/anthropic";
import { DECIDER_VOICE, type PlanStep } from "@/lib/decider";

// Mike answers the Decider's questions about his day (e.g. a retrospective
// "what did you wear round town?"). She reads the day-plan + his answer and
// responds in character. If he mentions wearing a specific catalogued pair for
// a stretch of time, she also flags it as a wear to log — but she does NOT log
// it here: she hands back a suggestion the app shows as a one-tap confirm, so
// nothing is recorded against a sock until Mike says yes.

type WearSuggestion = {
  sockId: string;
  name: string;
  label: string | null;
  hours: number;
  sport: boolean;
};

type Parsed = {
  reply: string;
  wear: Array<{ sock_id?: string; hours?: number; sport?: boolean }>;
};

function parse(text: string): Parsed {
  const fallback: Parsed = { reply: text.trim() || "Noted.", wear: [] };
  try {
    const s = text.indexOf("{");
    const e = text.lastIndexOf("}");
    if (s === -1 || e === -1) return fallback;
    const j = JSON.parse(text.slice(s, e + 1)) as Record<string, unknown>;
    const reply =
      typeof j.reply === "string" && j.reply.trim() ? j.reply.trim() : fallback.reply;
    const wear = Array.isArray(j.wear)
      ? (j.wear as Array<Record<string, unknown>>)
          .map((w) => ({
            sock_id: typeof w.sock_id === "string" ? w.sock_id : undefined,
            hours: Number(w.hours),
            sport: !!w.sport,
          }))
          .filter((w) => w.sock_id && w.hours > 0)
      : [];
    return { reply, wear };
  } catch {
    return fallback;
  }
}

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

  // His sock catalogue, so she can match what he says to an exact pair and we
  // can offer to log against it. Read defensively (label may be absent).
  const { data: sockRows } = await supabase
    .from("bf_footwear")
    .select("id, name, label, category")
    .eq("category", "socks")
    .order("created_at", { ascending: false });
  const socks = (sockRows ?? []) as Array<{
    id: string;
    name: string;
    label: string | null;
  }>;
  const sockList = socks
    .map((s) => `- id ${s.id} — label ${s.label ? `"${s.label}"` : "(none)"}, ${s.name}`)
    .join("\n")
    .slice(0, 2500);

  let parsed: Parsed = { reply: "Noted.", wear: [] };
  try {
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 320,
      messages: [
        {
          role: "user",
          content: `You are ${DECIDER_VOICE}

This is today's plan you laid out for Mike (some blocks may have been questions about what he actually did, since they'd already passed):
${planText || ch?.instruction || "(no plan on file)"}

Mike has just answered you:
"${answer.trim()}"

His sock catalogue (match only against these exact pairs):
${sockList || "(no socks catalogued)"}

Do two things:
1. Reply in 1–3 sentences, in your voice, directly to Mike — acknowledge what he tells you he did with his feet/socks/footwear, react to it (pleased, teasing, or noting it for later), and only add a small follow-up if it genuinely fits.
2. If he clearly says he WORE a specific catalogued pair for some length of time, list it so it can be logged. Only include a pair when you're confident he names it (by its label or an unmistakable description) AND gives or implies a duration. Estimate hours if he's vague ("most of the afternoon" ≈ 4). Set "sport": true if that wear was a sweaty sport session (padel, racketball, squash, tennis, a run, the gym) — sport soaks a sock far worse than ordinary wear, so it must be marked. Never invent a pair he didn't mention.

Return ONLY JSON, no preamble, no markdown:
{ "reply": "your message to Mike", "wear": [ { "sock_id": "the exact id from the list", "hours": 2, "sport": false } ] }
If he didn't clearly wear a catalogued pair, use "wear": [].`,
        },
      ],
    });
    parsed = parse(
      msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim()
    );
  } catch (err) {
    console.error("[plan/reply] anthropic error", err);
    const e = err as { status?: number; message?: string };
    const m =
      e.status === 401
        ? "Anthropic key rejected — check the ANTHROPIC_API_KEY in Vercel."
        : e.message || "AI request failed";
    return NextResponse.json({ error: m }, { status: 502 });
  }

  // Resolve the suggested wear ids back to real catalogue pairs (drops any id
  // she invented) and attach display names for the confirm button.
  const byId = new Map(socks.map((s) => [s.id, s]));
  const suggestions: WearSuggestion[] = parsed.wear
    .map((w) => {
      const s = w.sock_id ? byId.get(w.sock_id) : undefined;
      if (!s) return null;
      return {
        sockId: s.id,
        name: s.name,
        label: s.label,
        hours: Math.round((w.hours ?? 0) * 2) / 2,
        sport: !!w.sport,
      };
    })
    .filter((x): x is WearSuggestion => !!x && x.hours > 0);

  // Keep a record of what he reported (resilient — bf_memory has no kind
  // constraint). Stored as a note so it's part of the day's account.
  await supabase.from("bf_memory").insert({
    user_id: user.id,
    kind: "note",
    title: answer.trim().slice(0, 500),
    status: "done",
  });

  console.log("[plan/reply] done", { suggestions: suggestions.length });
  return NextResponse.json({ reply: parsed.reply, wear: suggestions });
}
