import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, CLAUDE_MODEL, sniffImageType } from "@/lib/anthropic";
import { PERSONAS } from "@/lib/decider";

// Files a close-up the Roaster demanded "for the file": looks at the uploaded
// photo and writes a short, cutting note kept on record to fuel future roasts.
export async function POST(request: Request) {
  console.log("[gallery/file] start");

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
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const { data: shot, error: shotErr } = await supabase
    .from("bf_gallery")
    .select("id, prompt, status, photo_path")
    .eq("id", id)
    .single();
  if (shotErr || !shot) {
    return NextResponse.json({ error: "Gallery item not found." }, { status: 404 });
  }
  if (!shot.photo_path) {
    return NextResponse.json(
      { error: "No photo uploaded for this demand yet." },
      { status: 400 }
    );
  }

  const { data: file, error: dlErr } = await supabase.storage
    .from("bf-feet")
    .download(shot.photo_path);
  if (dlErr || !file) {
    return NextResponse.json(
      { error: `Image download failed: ${dlErr?.message ?? "unknown"}` },
      { status: 500 }
    );
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const mediaType = sniffImageType(buf);
  if (!mediaType) {
    return NextResponse.json(
      {
        error:
          "That image format isn't supported (HEIC photos can't be read). Please upload a JPEG or PNG — on iPhone, Settings → Camera → Formats → Most Compatible.",
      },
      { status: 400 }
    );
  }
  const base64 = buf.toString("base64");

  let note = "";
  try {
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 300,
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
              text: `You are the Roaster keeping a private file on Mike's feet. Voice: ${PERSONAS.roaster.voice}

You demanded this exact close-up for the file:
"${shot.prompt}"

He's now submitted the photo above. Write ONE or TWO sharp, vivid sentences for the file — note the specific, identifying details you actually see (shape, condition, any blemish or quirk) in your cutting voice, the kind of thing you'll throw back at him in a future roast. No preamble, no markdown, no quotes — just the note.`,
            },
          ],
        },
      ],
    });
    note = msg.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim()
      .slice(0, 600);
  } catch (err) {
    console.error("[gallery/file] anthropic error", err);
    const e = err as { status?: number; message?: string };
    const m =
      e.status === 401
        ? "Anthropic key rejected — check the ANTHROPIC_API_KEY in Vercel."
        : e.message || "AI request failed";
    return NextResponse.json({ error: m }, { status: 502 });
  }

  await supabase
    .from("bf_gallery")
    .update({
      status: "filed",
      note: note || "Filed without comment.",
      filed_at: new Date().toISOString(),
    })
    .eq("id", shot.id);

  console.log("[gallery/file] done");
  return NextResponse.json({ note });
}
