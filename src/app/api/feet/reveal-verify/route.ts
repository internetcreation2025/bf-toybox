import { NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { anthropic, CLAUDE_MODEL, sniffImageType } from "@/lib/anthropic";
import { DECIDER_VOICE } from "@/lib/decider";

// Verifies a "show me your feet" proof: is this Mike's own bare foot, and does
// it show what she asked for? On a pass it's logged to bf_foot_checks as an
// achievement — with extra weight if he pulled it off somewhere awkward.
type Result = { ownFoot: boolean; showsRequested: boolean; line: string };

function parse(text: string): Result {
  const fallback: Result = {
    ownFoot: false,
    showsRequested: false,
    line: "I couldn't quite make that out — try once more.",
  };
  try {
    const s = text.indexOf("{");
    const e = text.lastIndexOf("}");
    if (s === -1 || e === -1) return fallback;
    const j = JSON.parse(text.slice(s, e + 1)) as Record<string, unknown>;
    return {
      ownFoot: !!j.own_foot,
      showsRequested: !!j.shows_requested,
      line:
        typeof j.line === "string" && j.line.trim() ? j.line.trim() : fallback.line,
    };
  } catch {
    return fallback;
  }
}

export async function POST(request: Request) {
  console.log("[feet/reveal-verify] start");

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

  const { image, request: asked, location, difficult } = (await request.json()) as {
    image?: string;
    request?: string;
    location?: string;
    difficult?: boolean;
  };
  if (!image || !asked?.trim()) {
    return NextResponse.json({ error: "image and request required" }, { status: 400 });
  }

  const base64 = image.includes(",") ? image.split(",")[1] : image;
  const buf = Buffer.from(base64, "base64");
  const proofType = sniffImageType(buf);
  if (!proofType) {
    return NextResponse.json(
      { error: "Couldn't read that image (HEIC isn't supported — use JPEG/PNG)." },
      { status: 400 }
    );
  }

  // A couple of reference fingerprints/images so she can confirm it's HIS foot.
  const { data: refs } = await supabase
    .from("bf_foot_refs")
    .select("angle, photo_path, ai_fingerprint")
    .not("ai_fingerprint", "is", null)
    .limit(8);
  const fpText = (refs ?? [])
    .filter((r) => r.ai_fingerprint)
    .slice(0, 6)
    .map((r) => `Angle "${r.angle}": ${r.ai_fingerprint}`)
    .join("\n\n");

  const content: Anthropic.ContentBlockParam[] = [];
  // One reference image if available.
  const firstRef = (refs ?? [])[0];
  if (firstRef?.photo_path) {
    const { data: f } = await supabase.storage
      .from("bf-feet")
      .download(firstRef.photo_path as string);
    if (f) {
      const rb = Buffer.from(await f.arrayBuffer());
      const t = sniffImageType(rb);
      if (t) {
        content.push({ type: "text", text: "REFERENCE photo of his own foot:" });
        content.push({
          type: "image",
          source: { type: "base64", media_type: t, data: rb.toString("base64") },
        });
      }
    }
  }
  if (fpText) {
    content.push({ type: "text", text: `My own notes describing my feet:\n${fpText}` });
  }
  content.push({ type: "text", text: "PROOF photo submitted right now:" });
  content.push({
    type: "image",
    source: { type: "base64", media_type: proofType, data: base64 },
  });
  content.push({
    type: "text",
    text: `You are ${DECIDER_VOICE}

This is Mike checking his OWN photo in his own private game — the reference notes are of his own feet, from his own catalogue. You asked him: "${asked.trim()}". Judge the PROOF photo.
1. Is this a real bare foot, consistent with his own catalogued feet (so he isn't cheating with someone else's photo)? Be fair, not paranoid.
2. Does it show what you asked for?

Return ONLY JSON: { "own_foot": true/false, "shows_requested": true/false, "line": "one short sentence to Mike in your voice about the result" }`,
  });

  let result: Result;
  try {
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 200,
      messages: [{ role: "user", content }],
    });
    result = parse(
      msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim()
    );
  } catch (err) {
    console.error("[feet/reveal-verify] anthropic error", err);
    const e = err as { status?: number; message?: string };
    const m =
      e.status === 401
        ? "Anthropic key rejected — check the ANTHROPIC_API_KEY in Vercel."
        : e.message || "AI request failed";
    return NextResponse.json({ error: m }, { status: 502 });
  }

  const passed = result.ownFoot && result.showsRequested;

  if (passed) {
    // Log the achievement (resilient — no-ops until bf_foot_checks exists).
    await supabase.from("bf_foot_checks").insert({
      user_id: user.id,
      request: asked.trim().slice(0, 300),
      location: location?.trim().slice(0, 120) || null,
      difficult: !!difficult,
      passed: true,
    });
  }

  console.log("[feet/reveal-verify] done", { passed, difficult: !!difficult });
  return NextResponse.json({ passed, message: result.line, difficult: !!difficult });
}
