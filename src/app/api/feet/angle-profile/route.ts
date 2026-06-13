import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { anthropic, CLAUDE_MODEL, sniffImageType } from "@/lib/anthropic";
import { FOOT_ANGLES } from "@/lib/feet";

// Builds ONE consolidated identity profile for a foot angle, synthesised across
// ALL the photos in that angle. Stored in bf_foot_angle_profiles.
const MAX_PHOTOS = 6;

export async function POST(request: Request) {
  console.log("[feet/angle-profile] start");

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

  const { angle } = (await request.json()) as { angle?: string };
  if (!angle) return NextResponse.json({ error: "angle required" }, { status: 400 });
  const angleLabel = FOOT_ANGLES.find((a) => a.key === angle)?.label ?? angle;

  const { data: rows } = await supabase
    .from("bf_foot_refs")
    .select("photo_path")
    .eq("angle", angle)
    .order("created_at", { ascending: true });
  const paths = (rows ?? [])
    .map((r) => r.photo_path as string)
    .filter(Boolean)
    .slice(0, MAX_PHOTOS);
  if (paths.length === 0) {
    return NextResponse.json(
      { error: "No photos in this angle yet." },
      { status: 400 }
    );
  }

  const images: Anthropic.ContentBlockParam[] = [];
  for (const path of paths) {
    const { data: file } = await supabase.storage.from("bf-feet").download(path);
    if (!file) continue;
    const buf = Buffer.from(await file.arrayBuffer());
    const mediaType = sniffImageType(buf);
    if (!mediaType) continue;
    images.push({
      type: "image",
      source: { type: "base64", media_type: mediaType, data: buf.toString("base64") },
    });
  }
  if (images.length === 0) {
    return NextResponse.json(
      { error: "Couldn't read those photos (HEIC isn't supported — use JPEG/PNG)." },
      { status: 400 }
    );
  }

  let profile = "";
  try {
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            ...images,
            {
              type: "text",
              text: `These are ${images.length} photo(s) of MY OWN "${angleLabel}", from my personal foot journal. Write ONE consolidated description of how this view of my foot looks — overall shape and proportions, the toes and nails, skin condition, and anything notable like dry patches, calluses or marks worth tracking over time. Synthesise across the photos; ignore differences that are just lighting or angle. These are my own notes about my own feet, for my records. 3 to 5 sentences, plain prose, no preamble, no markdown.`,
            },
          ],
        },
      ],
    });
    profile = msg.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim()
      .slice(0, 1500);
  } catch (err) {
    console.error("[feet/angle-profile] anthropic error", err);
    const e = err as { status?: number; message?: string };
    const m =
      e.status === 401
        ? "Anthropic key rejected — check the ANTHROPIC_API_KEY in Vercel."
        : e.message || "AI request failed";
    return NextResponse.json({ error: m }, { status: 502 });
  }

  // Resilient: no-ops if bf_foot_angle_profiles isn't there yet.
  await supabase
    .from("bf_foot_angle_profiles")
    .upsert(
      { user_id: user.id, angle, profile, updated_at: new Date().toISOString() },
      { onConflict: "user_id,angle" }
    );

  console.log("[feet/angle-profile] done", angle);
  return NextResponse.json({ profile });
}
