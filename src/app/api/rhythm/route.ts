import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, CLAUDE_MODEL } from "@/lib/anthropic";
import { DECIDER_VOICE } from "@/lib/decider";
import { getValidAccessToken } from "@/lib/google-oauth";
import { listEvents } from "@/lib/gcal-server";

// Generates the Decider's morning or evening message for the daily rhythm
// feature. Owner-only. Returns { message } on success, { error } on failure.
export async function GET(request: Request) {
  console.log("[rhythm] start");

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
      {
        error:
          "Server is missing ANTHROPIC_API_KEY — set it in Vercel and redeploy.",
      },
      { status: 500 }
    );
  }

  const url = new URL(request.url);
  const part = url.searchParams.get("part");
  if (part !== "morning" && part !== "evening") {
    return NextResponse.json(
      { error: "part must be 'morning' or 'evening'" },
      { status: 400 }
    );
  }

  const nowIso = new Date().toISOString();
  const todayIso = nowIso.slice(0, 10);

  let message = "";

  if (part === "morning") {
    // ── MORNING context ───────────────────────────────────────────────────────

    // (a) Today's calendar events — best-effort, skip silently if not connected.
    let calendarText = "";
    try {
      const token = await getValidAccessToken(supabase, user.id);
      if (token) {
        const timeMin = `${todayIso}T00:00:00.000Z`;
        const timeMax = `${todayIso}T23:59:59.000Z`;
        const events = await listEvents(token, timeMin, timeMax);
        if (events.length) {
          calendarText = events
            .map((e) => {
              const loc = e.location ? ` @ ${e.location}` : "";
              if (e.allDay) return `All day: ${e.summary}${loc}`;
              const start = new Date(e.startIso).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              });
              return `${start}: ${e.summary}${loc}`;
            })
            .join("; ");
        }
      }
    } catch {
      // Calendar not connected or unavailable — carry on.
    }

    // (b) Recurring footwear — top few most-worn items from bf_footwear.
    const { data: footwearRows } = await supabase
      .from("bf_footwear")
      .select("name, label, category, worn_hours")
      .order("worn_hours", { ascending: false })
      .limit(4);
    const footwearText = (footwearRows ?? [])
      .map((f) => {
        const lbl = (f.label as string | null) ? ` (${f.label})` : "";
        return `${f.name}${lbl} — ${Math.round((f.worn_hours as number) ?? 0)}h worn`;
      })
      .join("; ");

    // (c) Most recent bold moment from bf_sock_log (resilient if table absent).
    const { data: boldRow } = await supabase
      .from("bf_sock_log")
      .select("note, created_at")
      .eq("event", "bold")
      .not("note", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const boldText = (boldRow as { note?: string; created_at?: string } | null)
      ?.note
      ? `Most recent bold moment: "${(boldRow as { note: string; created_at: string }).note}" (${(boldRow as { note: string; created_at: string }).created_at.slice(0, 10)})`
      : "";

    // (d) Open diary tasks from bf_memory.
    const { data: diaryRows } = await supabase
      .from("bf_memory")
      .select("title, game_on")
      .eq("kind", "diary")
      .eq("status", "open")
      .order("game_on", { ascending: true })
      .limit(3);
    const diaryText = (
      (diaryRows ?? []) as Array<{ title: string; game_on: string | null }>
    )
      .map((d) => `${d.title}${d.game_on ? ` (due ${d.game_on})` : ""}`)
      .join("; ");

    const prompt = `You are ${DECIDER_VOICE}

Write a warm, personal MORNING greeting to Mike — 2 to 4 sentences, in your voice, directly to him. Set the day's tone. You know this man's feet intimately.

Today's calendar: ${calendarText || "nothing in the calendar today"}
His most-worn footwear: ${footwearText || "none on record yet"}
${boldText ? boldText + "\n" : ""}${diaryText ? `Open diary tasks: ${diaryText}\n` : ""}
Nod to what's on his calendar today if there's anything interesting. If it fits naturally, make ONE callback to a past detail — a recurring pair, a recent bold moment — without forcing it. Keep it warm, specific, and alive. No bullet points, no lists — just her voice, as if she's been awake thinking about his day before he has.

Return ONLY your message, no preamble, no JSON.`;

    try {
      const msg = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      });
      message = msg.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("")
        .trim();
    } catch (err) {
      console.error("[rhythm] morning AI error", err);
      const e = err as { status?: number; message?: string };
      const m =
        e.status === 401
          ? "Anthropic key rejected — check the ANTHROPIC_API_KEY in Vercel."
          : e.message || "AI request failed";
      return NextResponse.json({ error: m }, { status: 502 });
    }
  } else {
    // ── EVENING context ───────────────────────────────────────────────────────

    // Today's wear events from bf_sock_log (resilient if table absent).
    const { data: wearRows } = await supabase
      .from("bf_sock_log")
      .select("event, hours, note, created_at")
      .in("event", ["worn", "bold"])
      .gte("created_at", `${todayIso}T00:00:00.000Z`)
      .order("created_at", { ascending: true });
    const wearText = (
      (wearRows ?? []) as Array<{
        event: string;
        hours: number | null;
        note: string | null;
      }>
    )
      .map((r) => {
        const note = r.note ? ` — "${r.note}"` : "";
        return `${r.event}${r.hours ? ` (${r.hours}h)` : ""}${note}`;
      })
      .join("; ");

    // Today's compliance checks (resilient if table absent).
    const { data: compRows } = await supabase
      .from("bf_compliance_checks")
      .select("compliant, reported, penalty")
      .gte("created_at", `${todayIso}T00:00:00.000Z`);
    const compText = (
      (compRows ?? []) as Array<{
        compliant: boolean | null;
        reported: string | null;
        penalty: string | null;
      }>
    )
      .map((c) => {
        const verdict = c.compliant ? "compliant" : "caught out";
        const pen = c.penalty ? ` (penalty: ${c.penalty})` : "";
        return `${verdict}: "${c.reported}"${pen}`;
      })
      .join("; ");

    // Today's foot checks (resilient if table absent).
    const { data: footRows } = await supabase
      .from("bf_foot_checks")
      .select("passed")
      .gte("created_at", `${todayIso}T00:00:00.000Z`);
    const footCheckText = (footRows ?? []).length
      ? `${((footRows ?? []) as Array<{ passed: boolean }>).filter((r) => r.passed).length} foot reveals passed today`
      : "";

    // Today's plan (most recent challenge from today).
    const { data: planRow } = await supabase
      .from("bf_challenges")
      .select("instruction")
      .in("status", ["issued", "sealed", "resolved"])
      .gte("created_at", `${todayIso}T00:00:00.000Z`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const planText =
      planRow && (planRow as { instruction?: string | null }).instruction
        ? `Today's plan: ${((planRow as { instruction: string }).instruction).slice(0, 400)}`
        : "";

    const hasActivity = !!(wearText || compText || footCheckText || planText);

    const prompt = `You are ${DECIDER_VOICE}

Write a warm, personal EVENING reflection for Mike — 2 to 4 sentences, in your voice, directly to him. End his day with her.

${planText ? planText + "\n" : ""}${wearText ? `What he wore today: ${wearText}\n` : ""}${compText ? `Spot-checks today: ${compText}\n` : ""}${footCheckText ? `${footCheckText}\n` : ""}
${
  hasActivity
    ? "React to what he actually did with his feet today — pleased, teasing, or noting-for-later. If something stands out (a bold moment, getting caught, a long wear), give it a line. An optional callback to a recurring pair or past pattern fits if it flows naturally."
    : "There's no logged footwear activity from today. She gently, warmly asks what he got up to — not accusing, just curious, a little wistful that she missed it."
}

No bullet points, no lists — just her voice, warm and observant, as if she's settling in at the end of the day with him.

Return ONLY your message, no preamble, no JSON.`;

    try {
      const msg = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      });
      message = msg.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("")
        .trim();
    } catch (err) {
      console.error("[rhythm] evening AI error", err);
      const e = err as { status?: number; message?: string };
      const m =
        e.status === 401
          ? "Anthropic key rejected — check the ANTHROPIC_API_KEY in Vercel."
          : e.message || "AI request failed";
      return NextResponse.json({ error: m }, { status: 502 });
    }
  }

  console.log("[rhythm] done", { part });
  return NextResponse.json({ message });
}
