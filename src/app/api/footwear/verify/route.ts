import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, CLAUDE_MODEL, sniffImageType } from "@/lib/anthropic";

// Verifies a sock's identity from a proof photo of its written label. Claude
// reads the label text in the photo; if it matches the catalogue label, the
// pair is marked verified. The proof should be the sock on the foot, standing,
// so the label sits upright (T16) — we ask Claude to read it the right way up.
export async function POST(request: Request) {
  console.log("[footwear/verify] start");

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

  const { id, image } = (await request.json()) as {
    id?: string;
    image?: string;
  };
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const { data: sock, error: sockErr } = await supabase
    .from("bf_footwear")
    .select("id, label, name, photo_path")
    .eq("id", id)
    .single();
  if (sockErr || !sock) {
    return NextResponse.json({ error: "sock not found" }, { status: 404 });
  }
  if (!sock.label) {
    return NextResponse.json(
      { error: "This pair has no label to check against. Add its label first." },
      { status: 400 }
    );
  }

  // Use the photo Mike uploaded just now if one was passed; otherwise fall back
  // to the pair's EXISTING catalogue photo — no new upload needed.
  let buf: Buffer;
  if (image) {
    const base64 = image.includes(",") ? image.split(",")[1] : image;
    buf = Buffer.from(base64, "base64");
  } else {
    if (!sock.photo_path) {
      return NextResponse.json(
        { error: "This pair has no photo yet. Add a photo of it first." },
        { status: 400 }
      );
    }
    const { data: file, error: dlErr } = await supabase.storage
      .from("bf-feet")
      .download(sock.photo_path as string);
    if (dlErr || !file) {
      return NextResponse.json(
        { error: "Couldn't open this pair's photo. Try re-uploading it." },
        { status: 400 }
      );
    }
    buf = Buffer.from(await file.arrayBuffer());
  }

  const mediaType = sniffImageType(buf);
  if (!mediaType) {
    return NextResponse.json(
      { error: "Couldn't read that image (HEIC isn't supported — use JPEG/PNG)." },
      { status: 400 }
    );
  }

  let read = "";
  try {
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 60,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: buf.toString("base64") },
            },
            {
              type: "text",
              text: `This is a photo of a sock. Somewhere on it there may be a small hand-written label/code (e.g. "S1", "S1a", "D2b"). Read that code exactly as written, the right way up. Reply with ONLY the code — nothing else. If you genuinely cannot find any label in the photo, reply with exactly: NONE`,
            },
          ],
        },
      ],
    });
    read = msg.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
  } catch (err) {
    console.error("[footwear/verify] anthropic error", err);
    const e = err as { status?: number; message?: string };
    const m =
      e.status === 401
        ? "Anthropic key rejected — check the ANTHROPIC_API_KEY in Vercel."
        : e.message || "AI request failed";
    return NextResponse.json({ error: m }, { status: 502 });
  }

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const verified = read !== "" && norm(read) === norm(sock.label);

  if (verified) {
    // Resilient — no-ops if verified_at isn't there yet.
    await supabase
      .from("bf_footwear")
      .update({ verified_at: new Date().toISOString() })
      .eq("id", sock.id);
  }

  console.log("[footwear/verify] done", { read, verified });
  return NextResponse.json({
    verified,
    read: read === "NONE" ? null : read,
  });
}
