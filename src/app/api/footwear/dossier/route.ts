import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, CLAUDE_MODEL, sniffImageType } from "@/lib/anthropic";
import type { Dossier } from "@/lib/decider";

// Profiles one footwear photo into a structured "dossier" (material,
// breathability, formality, condition) stored on bf_footwear.dossier. The
// Decider reasons from this — smell/sweat realism, dress-for-occasion, rotation.
function parseDossier(text: string): Dossier {
  const fallback: Dossier = {
    material: "unknown",
    breathability: "medium",
    formality: "casual",
    condition: "unknown",
    summary: "",
  };
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) return fallback;
    const j = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const str = (v: unknown, d: string) =>
      typeof v === "string" && v.trim() ? v.trim() : d;
    return {
      material: str(j.material, fallback.material),
      breathability: str(j.breathability, fallback.breathability).toLowerCase(),
      formality: str(j.formality, fallback.formality).toLowerCase(),
      condition: str(j.condition, fallback.condition),
      summary: str(j.summary, "").slice(0, 240),
    };
  } catch {
    return fallback;
  }
}

export async function POST(request: Request) {
  console.log("[footwear/dossier] start");

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

  const { data: item, error: itErr } = await supabase
    .from("bf_footwear")
    .select("id, name, category, photo_path")
    .eq("id", id)
    .single();
  if (itErr || !item) {
    return NextResponse.json({ error: "Footwear item not found." }, { status: 404 });
  }
  if (!item.photo_path) {
    return NextResponse.json(
      { error: "No photo on this item yet." },
      { status: 400 }
    );
  }

  const { data: file, error: dlErr } = await supabase.storage
    .from("bf-feet")
    .download(item.photo_path);
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

  let dossier: Dossier;
  try {
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 400,
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
              text: `This is a photo of a piece of footwear (or socks) the owner has. He's catalogued it as "${item.name}" (${item.category}).

Profile it so a footwear game can reason about how it behaves — how it dresses, how it breathes, how fast it builds odour. Judge ONLY from the photo + the name.

Return ONLY a JSON object (no markdown, no commentary):
{
  "material": "main material(s), e.g. leather, mesh, canvas, cotton",
  "breathability": "low | medium | high (how much air gets to the foot — leather/rubber low, mesh high)",
  "formality": "casual | smart | formal",
  "condition": "short note on visible condition (new, worn, scuffed, grubby, etc.)",
  "summary": "one short sentence the game can show and reason from"
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
    dossier = parseDossier(text);
  } catch (err) {
    console.error("[footwear/dossier] anthropic error", err);
    const e = err as { status?: number; message?: string };
    const m =
      e.status === 401
        ? "Anthropic key rejected — check the ANTHROPIC_API_KEY in Vercel."
        : e.message || "AI request failed";
    return NextResponse.json({ error: m }, { status: 502 });
  }

  await supabase.from("bf_footwear").update({ dossier }).eq("id", item.id);

  console.log("[footwear/dossier] done", item.name);
  return NextResponse.json({ dossier });
}
