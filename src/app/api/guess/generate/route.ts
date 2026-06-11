import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { generateImages, googleConfigured } from "@/lib/google";

// Owner-only. Generates a batch of AI foot photos (male + female) and banks
// them in storage + bf_guess_pool, so the guessing game can draw from them
// without paying to generate on every play.
const PROMPTS: Record<"male" | "female", string> = {
  male: "A realistic photographic close-up of an adult man's bare foot resting on a plain neutral grey surface, whole foot visible from a slight three-quarter angle, soft natural lighting, no shoes, no socks, no jewellery, no text, no watermark.",
  female:
    "A realistic photographic close-up of an adult woman's bare foot resting on a plain neutral grey surface, whole foot visible from a slight three-quarter angle, soft natural lighting, no shoes, no socks, no jewellery, no text, no watermark.",
};

function extFor(mime: string): string {
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  return "png";
}

export async function POST(request: Request) {
  console.log("[guess/generate] start");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const allowed = process.env.ALLOWED_EMAIL?.toLowerCase();
  if (!user || (allowed && user.email?.toLowerCase() !== allowed)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!googleConfigured) {
    return NextResponse.json(
      {
        error:
          "Server is missing GEMINI_API_KEY — add it in Vercel (and .env.local) and redeploy.",
      },
      { status: 500 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    perGender?: number;
  };
  const perGender = Math.max(1, Math.min(4, Number(body.perGender) || 3));

  const counts: Record<string, number> = { male: 0, female: 0 };
  try {
    for (const gender of ["male", "female"] as const) {
      const images = await generateImages(PROMPTS[gender], perGender);
      for (const img of images) {
        const path = `${user.id}/guess/${randomUUID()}.${extFor(img.mimeType)}`;
        const { error: upErr } = await supabase.storage
          .from("bf-feet")
          .upload(path, img.buffer, {
            upsert: true,
            contentType: img.mimeType,
          });
        if (upErr) throw upErr;
        const { error: rowErr } = await supabase
          .from("bf_guess_pool")
          .insert({ user_id: user.id, gender, image_path: path });
        if (rowErr) throw rowErr;
        counts[gender] += 1;
      }
    }
  } catch (err) {
    console.error("[guess/generate] error", err);
    const m = err instanceof Error ? err.message : "Generation failed";
    return NextResponse.json({ error: m }, { status: 502 });
  }

  const { count } = await supabase
    .from("bf_guess_pool")
    .select("id", { count: "exact", head: true });

  console.log("[guess/generate] done", counts);
  return NextResponse.json({ generated: counts, poolTotal: count ?? null });
}
