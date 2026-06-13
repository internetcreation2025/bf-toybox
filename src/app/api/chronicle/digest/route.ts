import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, CLAUDE_MODEL } from "@/lib/anthropic";
import { DECIDER_VOICE, type Rarity } from "@/lib/decider";

// The Archivist writes a weekly digest: a short, dramatic recap of the last 7
// days of foot life, built from the real records. Stored in bf_memory as a
// kind='digest' row (title holds the prose, game_on holds the week-ending date).
export async function POST() {
  console.log("[chronicle/digest] start");

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

  const now = new Date();
  const weekAgoIso = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const todayIso = now.toISOString().slice(0, 10);

  const [
    { data: footwear },
    { data: challenges },
    { data: sockLog },
    { data: memory },
  ] = await Promise.all([
    supabase.from("bf_footwear").select("id, name, label"),
    supabase
      .from("bf_challenges")
      .select("rarity, verdict_type, instruction, status, created_at")
      .gte("created_at", weekAgoIso),
    supabase
      .from("bf_sock_log")
      .select("sock_id, event, hours, played, dried, smell, created_at")
      .gte("created_at", weekAgoIso),
    supabase
      .from("bf_memory")
      .select("kind, title, created_at")
      .in("kind", ["diary", "prep", "game"])
      .gte("created_at", weekAgoIso),
  ]);

  const sockName = new Map<string, string>();
  for (const f of footwear ?? []) {
    const label = (f.label as string | null)?.trim();
    sockName.set(f.id as string, label ? `${f.name} (${label})` : (f.name as string));
  }

  // Roll tallies
  const rolls = challenges ?? [];
  const rarityTally: Record<string, number> = {};
  let verified = 0;
  let failed = 0;
  for (const c of rolls) {
    rarityTally[c.rarity as Rarity] = (rarityTally[c.rarity as Rarity] || 0) + 1;
    if (c.status === "verified") verified += 1;
    if (c.status === "failed") failed += 1;
  }

  // Sock tallies — hours per sock to crown a "sock of the week"
  const log = sockLog ?? [];
  const hoursBySock = new Map<string, number>();
  let washes = 0;
  let peakSmell = 0;
  let peakSock = "";
  for (const r of log) {
    if (r.event === "washed") {
      washes += 1;
      continue;
    }
    const id = r.sock_id as string;
    hoursBySock.set(id, (hoursBySock.get(id) || 0) + (Number(r.hours) || 0));
    const s = Number(r.smell) || 0;
    if (s > peakSmell) {
      peakSmell = s;
      peakSock = sockName.get(id) ?? "a sock";
    }
  }
  let sockOfWeek = "";
  let mostHours = 0;
  for (const [id, h] of hoursBySock) {
    if (h > mostHours) {
      mostHours = h;
      sockOfWeek = sockName.get(id) ?? "a sock";
    }
  }

  const diaryItems = (memory ?? []).length;

  const nothingHappened =
    rolls.length === 0 && log.length === 0 && diaryItems === 0;

  const facts = [
    `Verdicts rolled this week: ${rolls.length}` +
      (rolls.length
        ? ` (${Object.entries(rarityTally)
            .map(([k, v]) => `${v} ${k}`)
            .join(", ")})`
        : ""),
    `Proof dares: ${verified} verified, ${failed} failed`,
    `Sock wears logged: ${log.filter((r) => r.event !== "washed").length}`,
    `Washes: ${washes}`,
    sockOfWeek
      ? `Most-worn sock (sock of the week): ${sockOfWeek}, ${Math.round(mostHours)}h`
      : `No single sock stood out.`,
    peakSock ? `Ripest moment: ${peakSock} hit ${peakSmell}/10` : null,
    `Diary/prep items set: ${diaryItems}`,
  ]
    .filter(Boolean)
    .join("\n");

  let text = "";
  try {
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: nothingHappened
            ? `You are the Decider, keeping a private footwear chronicle. Voice: ${DECIDER_VOICE}\n\nThe week ending ${todayIso} has NO recorded foot activity at all — a quiet, empty page. Write 2 to 3 sentences marking the quiet week in your voice, with a faint, fond nudge to make next week worth recording. No markdown, no headings, no quotes.`
            : `You are the Decider, keeping a private footwear chronicle. Voice: ${DECIDER_VOICE}

Write the weekly digest for the week ending ${todayIso} — a short recap, 4 to 7 sentences, of the life of Mike's feet this week, in your own fond, knowing voice. Crown the "sock of the week" if there is one, note any milestones or ripe moments, and close with a touch of anticipation for next week. Use ONLY the recorded facts below; do not invent events. No markdown, no headings, no quotes — just the prose.

RECORDED FACTS (week ending ${todayIso})
${facts}`,
        },
      ],
    });
    text = msg.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim()
      .slice(0, 2000);
  } catch (err) {
    console.error("[chronicle/digest] anthropic error", err);
    const e = err as { status?: number; message?: string };
    const m =
      e.status === 401
        ? "Anthropic key rejected — check the ANTHROPIC_API_KEY in Vercel."
        : e.message || "AI request failed";
    return NextResponse.json({ error: m }, { status: 502 });
  }

  await supabase.from("bf_memory").insert({
    user_id: user.id,
    kind: "digest",
    title: text,
    game_on: todayIso,
    status: "open",
  });

  console.log("[chronicle/digest] done");
  return NextResponse.json({ digest: text });
}
