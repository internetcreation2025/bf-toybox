import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, CLAUDE_MODEL } from "@/lib/anthropic";
import { PERSONAS } from "@/lib/decider";
import { describeSock } from "@/lib/socks";

// The Archivist writes a short, evolving "biography" for one sock, built from
// its real recorded history (wears, washes, sport, what it's been paired with).
export async function POST(request: Request) {
  console.log("[footwear/biography] start");

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

  const { id } = (await request.json()) as { id?: string };
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { data: sock, error: sockErr } = await supabase
    .from("bf_footwear")
    .select("*")
    .eq("id", id)
    .single();
  if (sockErr || !sock) {
    return NextResponse.json({ error: "Sock not found." }, { status: 404 });
  }
  if (sock.category !== "socks") {
    return NextResponse.json(
      { error: "Biographies are for socks only." },
      { status: 400 }
    );
  }

  // Full wear/wash audit trail.
  const { data: logRows } = await supabase
    .from("bf_sock_log")
    .select("event, hours, played, dried, smell, created_at")
    .eq("sock_id", id)
    .order("created_at", { ascending: true });
  const log = logRows ?? [];

  const worn = log.filter((r) => r.event !== "washed");
  const washes = log.filter((r) => r.event === "washed").length;
  const totalHours = worn.reduce((a, r) => a + (Number(r.hours) || 0), 0);
  const sportSessions = worn.reduce((a, r) => a + (Number(r.played) || 0), 0);
  const driedReuses = worn.reduce((a, r) => a + (Number(r.dried) || 0), 0);
  const peakSmell = log.reduce(
    (m, r) => Math.max(m, Number(r.smell) || 0),
    0
  );
  const firstSeen =
    (log[0]?.created_at as string | undefined) ??
    (sock.created_at as string | undefined) ??
    null;

  // What shoes this pair has been sent out with (co-occurrence in past rolls).
  const { data: challenges } = await supabase
    .from("bf_challenges")
    .select("wear_json")
    .order("created_at", { ascending: false })
    .limit(200);
  const pairedWith = new Set<string>();
  for (const c of challenges ?? []) {
    const wj = c.wear_json as
      | { items?: Array<{ id?: string; name?: string; category?: string }> }
      | null;
    const items = Array.isArray(wj?.items) ? wj!.items : [];
    if (!items.some((i) => i.id === id)) continue;
    for (const i of items) {
      if (i.category !== "socks" && i.name) pairedWith.add(i.name);
    }
  }

  const stageDesc = describeSock(sock);

  const facts = [
    `Name: ${sock.name}`,
    sock.label ? `Physical label/number: "${sock.label}"` : null,
    sock.colour ? `Colour: ${sock.colour}` : null,
    firstSeen ? `First on record: ${String(firstSeen).slice(0, 10)}` : null,
    `Recorded wears: ${worn.length}`,
    `Total hours worn (all time): ${Math.round(totalHours)}`,
    `Sport sessions played in: ${sportSessions}`,
    `Wet-then-dried re-wears: ${driedReuses}`,
    `Times washed: ${washes}`,
    `Peak recorded smell: ${peakSmell}/10`,
    `Current life-stage: ${stageDesc.label} — ${stageDesc.hint}`,
    pairedWith.size
      ? `Footwear it's been worn inside: ${[...pairedWith].join(", ")}`
      : `No footwear pairings recorded yet.`,
  ]
    .filter(Boolean)
    .join("\n");

  let bio = "";
  try {
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content: `You are The Archivist of a private footwear chronicle. Voice: ${PERSONAS.archivist.voice}

Write a short biography — 3 to 5 sentences — of this single pair of socks, as an entry in the permanent case file. Treat the pair as a character with a life so far. Use ONLY the recorded facts below; do not invent events, places or people. Lean on the numbers to give it shape (a well-travelled veteran, a pampered newcomer, a notorious ripe offender, etc.). No markdown, no headings, no quotes — just the biography prose.

RECORDED FACTS
${facts}`,
        },
      ],
    });
    bio = msg.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim()
      .slice(0, 1200);
  } catch (err) {
    console.error("[footwear/biography] anthropic error", err);
    const e = err as { status?: number; message?: string };
    const m =
      e.status === 401
        ? "Anthropic key rejected — check the ANTHROPIC_API_KEY in Vercel."
        : e.message || "AI request failed";
    return NextResponse.json({ error: m }, { status: 502 });
  }

  // Resilient: silently no-ops if the bio columns aren't present yet.
  await supabase
    .from("bf_footwear")
    .update({ bio, bio_updated_at: new Date().toISOString() })
    .eq("id", id);

  console.log("[footwear/biography] done");
  return NextResponse.json({ bio });
}
