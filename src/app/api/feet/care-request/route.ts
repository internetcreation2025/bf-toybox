import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { anthropic, CLAUDE_MODEL, sniffImageType } from "@/lib/anthropic";
import { DECIDER_VOICE } from "@/lib/decider";
import { FOOT_ANGLES } from "@/lib/feet";

// Foot care is the Decider's call, not a chore Mike sets himself. She reviews
// his feet — recent reference photos + what she already knows — and decides
// whether any upkeep is genuinely warranted. If so she sets ONE care task
// (area + action) into bf_foot_care; if not, she says they're well kept.
const MAX_PHOTOS = 4;
// Angles where nails, hard skin and calluses actually show.
const CARE_ANGLES = [
  "sole_left",
  "sole_right",
  "heel_left",
  "heel_right",
  "top_left",
  "top_right",
];

export async function POST() {
  console.log("[feet/care-request] start");

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

  // Gather recent reference photos, preferring the care-revealing angles.
  const { data: refs } = await supabase
    .from("bf_foot_refs")
    .select("angle, photo_path, ai_fingerprint, created_at")
    .order("created_at", { ascending: false });
  const rows = (refs ?? []) as Array<{
    angle: string;
    photo_path: string;
    ai_fingerprint: string | null;
  }>;
  const ordered = [...rows].sort((a, b) => {
    const ai = CARE_ANGLES.indexOf(a.angle);
    const bi = CARE_ANGLES.indexOf(b.angle);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const images: Anthropic.ContentBlockParam[] = [];
  for (const r of ordered.slice(0, MAX_PHOTOS)) {
    const { data: file } = await supabase.storage.from("bf-feet").download(r.photo_path);
    if (!file) continue;
    const buf = Buffer.from(await file.arrayBuffer());
    const mediaType = sniffImageType(buf);
    if (!mediaType) continue;
    const label = FOOT_ANGLES.find((a) => a.key === r.angle)?.label ?? r.angle;
    images.push({ type: "text", text: `${label}:` });
    images.push({
      type: "image",
      source: { type: "base64", media_type: mediaType, data: buf.toString("base64") },
    });
  }

  // Don't re-ask for care that's already on his list.
  const { data: openTasks } = await supabase
    .from("bf_foot_care")
    .select("area, action")
    .eq("done", false);
  const pending = (openTasks ?? [])
    .map((t) => `${t.area}: ${t.action}`)
    .join("; ");

  let needed = false;
  let area = "";
  let action = "";
  let message = "";
  try {
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 260,
      messages: [
        {
          role: "user",
          content: [
            ...images,
            {
              type: "text",
              text: `You are ${DECIDER_VOICE}

Drawing on your real podiatry knowledge, look over Mike's feet${
                images.length ? " in the photos above" : " (no fresh photos on file)"
              } and decide whether any foot care is genuinely warranted right now — an overgrown or uneven nail, hard skin or a callus to file, dryness to moisturise, dirt to scrub. Only ask for care that's actually needed; don't invent chores.
${pending ? `Care already on his list (do NOT repeat): ${pending}.` : ""}

If care IS warranted, reply EXACTLY:
NEEDED: yes
AREA: <the precise spot, e.g. right big toenail / left heel>
ACTION: <what to do, e.g. trim straight across / file the hard skin / moisturise>
NOTE: <one short sentence to Mike, in your voice>

If nothing is needed, reply EXACTLY:
NEEDED: no
NOTE: <one short reassuring sentence, in your voice>`,
            },
          ],
        },
      ],
    });
    const text = msg.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    needed = /NEEDED:\s*yes/i.test(text);
    area = (text.match(/AREA:\s*(.+)/i)?.[1] ?? "").trim().slice(0, 120);
    action = (text.match(/ACTION:\s*(.+)/i)?.[1] ?? "").trim().slice(0, 160);
    message = (text.match(/NOTE:\s*(.+)/i)?.[1] ?? "").trim().slice(0, 300);
  } catch (err) {
    console.error("[feet/care-request] anthropic error", err);
    const e = err as { status?: number; message?: string };
    const m =
      e.status === 401
        ? "Anthropic key rejected — check the ANTHROPIC_API_KEY in Vercel."
        : e.message || "AI request failed";
    return NextResponse.json({ error: m }, { status: 502 });
  }

  if (needed && area && action) {
    const { error: insErr } = await supabase
      .from("bf_foot_care")
      .insert({ user_id: user.id, area, action });
    if (insErr) {
      return NextResponse.json(
        { error: "Run the foot-care SQL first, then try again." },
        { status: 400 }
      );
    }
    console.log("[feet/care-request] task set", area);
    return NextResponse.json({ needed: true, area, action, message });
  }

  console.log("[feet/care-request] no care needed");
  return NextResponse.json({
    needed: false,
    message: message || "Your feet look well kept — nothing to do right now.",
  });
}
