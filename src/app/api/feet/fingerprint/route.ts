import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, CLAUDE_MODEL, normaliseImageType } from "@/lib/anthropic";

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

  const { angle } = (await request.json()) as { angle?: string };
  if (!angle) {
    return NextResponse.json({ error: "angle required" }, { status: 400 });
  }

  // RLS guarantees this only returns the owner's own row.
  const { data: ref, error: refErr } = await supabase
    .from("bf_foot_refs")
    .select("*")
    .eq("angle", angle)
    .single();
  if (refErr || !ref) {
    return NextResponse.json({ error: "reference not found" }, { status: 404 });
  }

  const { data: file, error: dlErr } = await supabase.storage
    .from("bf-feet")
    .download(ref.photo_path);
  if (dlErr || !file) {
    return NextResponse.json({ error: "image download failed" }, { status: 500 });
  }

  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  const mediaType = normaliseImageType(file.type);

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
            text: `This is a reference photo of the owner's own foot. Angle: "${angle}".
Write a concise but detailed visual fingerprint to later match new photos to this same foot.
Focus ONLY on stable, identifying features — ignore lighting, background, and pose:
- relative toe lengths / ordering
- toenail shape and any distinctive nails
- freckles, moles, or scars (approximate position)
- prominent veins or tendons
- knuckle / joint prominences
- arch shape and overall proportions
- skin tone
Return 4–8 short bullet points. No preamble, no caveats.`,
          },
        ],
      },
    ],
  });

  const fingerprint = message.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();

  await supabase
    .from("bf_foot_refs")
    .update({ ai_fingerprint: fingerprint, updated_at: new Date().toISOString() })
    .eq("id", ref.id);

  console.log("[feet/fingerprint] done", angle);
  return NextResponse.json({ fingerprint });
}
