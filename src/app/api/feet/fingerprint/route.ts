import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, CLAUDE_MODEL, sniffImageType } from "@/lib/anthropic";

// Generates a detailed visual "fingerprint" of one reference foot photo and
// stores it on the bf_foot_refs row. This is the app's visual memory.
export async function POST(request: Request) {
  console.log("[feet/fingerprint] start");

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

  // Accept a specific photo id (multiple photos per angle now); fall back to
  // angle for older callers (uses the most recent photo for that angle).
  const { id, angle } = (await request.json()) as {
    id?: string;
    angle?: string;
  };
  if (!id && !angle) {
    return NextResponse.json({ error: "id or angle required" }, { status: 400 });
  }

  const query = supabase.from("bf_foot_refs").select("*");
  const { data: ref, error: refErr } = id
    ? await query.eq("id", id).single()
    : await query
        .eq("angle", angle as string)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
  if (refErr || !ref) {
    return NextResponse.json({ error: "reference not found" }, { status: 404 });
  }

  const { data: file, error: dlErr } = await supabase.storage
    .from("bf-feet")
    .download(ref.photo_path);
  if (dlErr || !file) {
    return NextResponse.json(
      { error: `image download failed: ${dlErr?.message ?? "unknown"}` },
      { status: 500 }
    );
  }

  const rawBuf = Buffer.from(await file.arrayBuffer());
  const mediaType = sniffImageType(rawBuf);
  if (!mediaType) {
    return NextResponse.json(
      {
        error:
          "That image format isn't supported (HEIC photos can't be read). Please upload a JPEG or PNG — on iPhone, Settings → Camera → Formats → Most Compatible.",
      },
      { status: 400 }
    );
  }
  const base64 = rawBuf.toString("base64");

  let fingerprint = "";
  try {
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1200,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64 },
            },
            {
              type: "text",
              text: `${
                ref.label
                  ? `This is a close-up of one spot on MY OWN foot — "${ref.label}" — that I'm keeping in my personal foot-care journal. Describe what's visible so I have a clear written note to compare against later and notice changes.`
                  : `This is a photo of MY OWN foot (view: "${ref.angle}") for my personal foot-care and footwear journal. Describe what's visible so I have a written note for my own records.`
              }
Cover it factually and briefly — ignore lighting and background:
- overall shape and proportions of what's shown
- the toenail(s) and toe shape
- skin condition (dry skin, calluses, hard skin)
- anything worth keeping an eye on over time (marks, dryness, wear)
These are my own notes about my own feet, for tracking their condition and footwear over time. Return 4-6 short bullet points. No preamble, no caveats.`,
            },
          ],
        },
      ],
    });
    fingerprint = message.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
  } catch (err) {
    console.error("[feet/fingerprint] anthropic error", err);
    const e = err as { status?: number; message?: string };
    const msg =
      e.status === 401
        ? "Anthropic key rejected — check the ANTHROPIC_API_KEY in Vercel matches your current key."
        : e.message || "AI request failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  await supabase
    .from("bf_foot_refs")
    .update({ ai_fingerprint: fingerprint, updated_at: new Date().toISOString() })
    .eq("id", ref.id);

  console.log("[feet/fingerprint] done", angle);
  return NextResponse.json({ fingerprint });
}
