import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, CLAUDE_MODEL, sniffImageType } from "@/lib/anthropic";

// Diagnostic: reads a just-uploaded photo and reports (1) any short code
// written in it and (2) a detailed description — so the owner can prove the
// full pipeline works (phone → upload → storage → Claude vision in detail).
type Result = { code: string; description: string };

function parseResult(text: string): Result {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end !== -1) {
      const j = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
      return {
        code: typeof j.code === "string" ? j.code.trim() : "",
        description: typeof j.description === "string" ? j.description.trim() : "",
      };
    }
  } catch {
    /* fall through */
  }
  return { code: "", description: text.trim().slice(0, 800) };
}

export async function POST(request: Request) {
  console.log("[vision-test] start");

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

  const { path } = (await request.json()) as { path?: string };
  if (!path) {
    return NextResponse.json({ error: "path required" }, { status: 400 });
  }
  // Only let the owner read their own upload folder.
  if (!path.startsWith(`${user.id}/`)) {
    return NextResponse.json({ error: "forbidden path" }, { status: 403 });
  }

  const { data: file, error: dlErr } = await supabase.storage
    .from("bf-feet")
    .download(path);
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
          "That image format isn't supported (HEIC photos can't be read). On iPhone: Settings → Camera → Formats → Most Compatible.",
      },
      { status: 400 }
    );
  }

  let result: Result;
  try {
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 600,
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
              text: `This photo should contain a short hand-written CODE (a mix of letters and numbers). Read it precisely.

Return ONLY a JSON object:
{
  "code": "the exact code you can read, characters only (empty string if you genuinely can't find one)",
  "description": "2-4 sentences describing the image in detail — what's in it, the surface/background, and any small features you can make out, to show how much detail you can see"
}`,
            },
          ],
        },
      ],
    });
    const text = msg.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    result = parseResult(text);
  } catch (err) {
    console.error("[vision-test] anthropic error", err);
    const e = err as { status?: number; message?: string };
    return NextResponse.json(
      { error: e.message || "AI request failed" },
      { status: 502 }
    );
  }

  console.log("[vision-test] done", result.code);
  return NextResponse.json(result);
}
