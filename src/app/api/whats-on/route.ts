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
import type { PlanStep } from "@/lib/decider";

// "What's on your feet?" is a COMPLIANCE SPOT-CHECK, not a casual chat. The
// Decider has already laid out the day's footwear plan; Mike is meant to be
// obeying it. She asks (only via a push) what he actually has on, compares it
// to what the plan says he should be wearing right now, and praises him if he's
// obeying or catches him out if he's in the wrong footwear (wrong shoes, wrong
// socks, or socks/no-socks when it should be the opposite).
function parseVerdict(text: string): { compliant: boolean | null; line: string } {
  try {
    const s = text.indexOf("{");
    const e = text.lastIndexOf("}");
    if (s !== -1 && e !== -1) {
      const j = JSON.parse(text.slice(s, e + 1)) as Record<string, unknown>;
      return {
        compliant: typeof j.compliant === "boolean" ? j.compliant : null,
        line: typeof j.line === "string" ? j.line.trim() : text.trim(),
      };
    }
  } catch {
    /* fall through */
  }
  return { compliant: null, line: text.trim() };
}
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

  // The day's active plan — what he's SUPPOSED to have on. Only today's counts.
  const todayIso = new Date().toISOString().slice(0, 10);
  const { data: active } = await supabase
    .from("bf_challenges")
    .select("plan_json, instruction, created_at")
    .in("status", ["issued", "sealed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const planIsToday =
    active?.created_at &&
    (active.created_at as string).slice(0, 10) === todayIso;
  const planSteps = (planIsToday ? (active?.plan_json as PlanStep[] | null) : null) ?? null;
  const planText = planSteps
    ? planSteps
        .map(
          (s) =>
            `${s.when} — ${s.activity}: ${s.do}${s.after ? ` (after: ${s.after})` : ""}`
        )
        .join("\n")
        .slice(0, 2500)
    : "";

  let reply = "";
  let compliant: boolean | null = null;
  try {
    const prompt = planText
      ? `You are ${DECIDER_VOICE}

${base}

${normalityBlock(settings?.normality)}
${settings?.custom_instructions?.trim() ? `\nMike's extra notes to you:\n${settings.custom_instructions.trim()}\n` : ""}
This is a COMPLIANCE SPOT-CHECK. Earlier you set out his footwear plan for today, and he is meant to be obeying it. You've just pinged him, out of nowhere, to ask what's actually on his feet — and he's answered.

TODAY'S PLAN you set (what he SHOULD be wearing through the day):
${planText}

Right now: ${nowLabel || "an unspecified time"}.
What he says is on his feet: ${onFeet.trim()}.
Where he is: ${location?.trim() || "he didn't say"}.
${nearby ? `His calendar around now: ${nearby}.` : ""}

Work out which plan block covers RIGHT NOW, and judge whether what he has on matches what you told him to wear for it — the right shoes/footwear, AND the right sock state (socks vs bare, and the correct socks if you named a pair). Be fair: if the plan didn't specify this exact moment, give him the benefit of the doubt and treat him as compliant.

Return ONLY JSON: { "compliant": true or false, "line": "1–3 sentences in your voice, directly to Mike" }. If he's obeying, approve — warm, a little pleased. If he's caught out in the wrong footwear, say so plainly and let him feel the slip — a penalty is coming.`
      : `You are ${DECIDER_VOICE}

${base}

${normalityBlock(settings?.normality)}
${settings?.custom_instructions?.trim() ? `\nMike's extra notes to you:\n${settings.custom_instructions.trim()}\n` : ""}
You've pinged Mike to ask what's on his feet right now — but you haven't set a plan for today yet, so there's nothing to check against.

Right now: ${nowLabel || "an unspecified time"}. On his feet: ${onFeet.trim()}. Where he is: ${location?.trim() || "he didn't say"}.
${nearby ? `His calendar around now: ${nearby}.` : ""}

Reply in 1–3 sentences, in your voice — a knowing remark, and you may nudge him to roll today's plan so you can hold him to it. Return ONLY JSON: { "compliant": true, "line": "..." }.`;

    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 240,
      messages: [{ role: "user", content: prompt }],
    });
    const out = parseVerdict(
      msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim()
    );
    reply = out.line;
    compliant = planText ? out.compliant : null;
  } catch (err) {
    console.error("[whats-on] anthropic error", err);
    const e = err as { status?: number; message?: string };
    const m =
      e.status === 401
        ? "Anthropic key rejected — check the ANTHROPIC_API_KEY in Vercel."
        : e.message || "AI request failed";
    return NextResponse.json({ error: m }, { status: 502 });
  }

  // Log the spot-check so penalties can draw on it later (resilient — no-ops
  // until bf_compliance_checks exists). Only logs when there was a plan to obey.
  if (compliant !== null) {
    await supabase.from("bf_compliance_checks").insert({
      user_id: user.id,
      reported: onFeet.trim().slice(0, 300),
      compliant,
    });
  }

  console.log("[whats-on] done", { compliant });
  return NextResponse.json({ reply, compliant });
}
