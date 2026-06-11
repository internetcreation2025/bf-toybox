import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { generateImages, googleConfigured } from "@/lib/google";

// Owner-only. Generates a batch of AI foot photos (male + female) and banks
// them in storage + bf_guess_pool, so the guessing game can draw from them
// without paying to generate on every play.
//
// Variety is the point: each image is generated on its OWN request (sampleCount
// 1) with a different close-up SHOT and a different-looking foot, so no two come
// out the same.
const SHOTS = [
  "an extreme macro close-up of just the heel, seen from behind",
  "a macro close-up of the underside pads of the toes",
  "a close-up of the sole and mid-foot",
  "a close-up of the inner arch from the side",
  "a close-up of the outer edge of the foot showing the little toe",
  "a close-up of the top of the foot and toes from above",
  "a macro close-up of the big toe and its toenail",
  "a close-up of the ball of the foot and toe pads",
  "a close-up of the ankle, Achilles and back of the heel",
];
const TONES = ["fair", "olive", "light brown", "brown", "deep brown"];
const BUILDS = ["slender", "broad", "average", "long and narrow"];

function buildPrompt(
  gender: "male" | "female",
  shot: string,
  tone: string,
  build: string
): string {
  const who = gender === "male" ? "an adult man's" : "an adult woman's";
  return `A realistic, sharply focused photographic ${shot} of ${who} bare foot. ${tone} skin, ${build} foot. Plain neutral grey background, soft even studio lighting, no shoes, no socks, no jewellery, no text, no watermark.`;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

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
      // Distinct shot per image so the parts vary within the batch.
      const shots = shuffle(SHOTS);
      for (let i = 0; i < perGender; i++) {
        const shot = shots[i % shots.length];
        const tone = TONES[Math.floor(Math.random() * TONES.length)];
        const build = BUILDS[Math.floor(Math.random() * BUILDS.length)];
        const images = await generateImages(
          buildPrompt(gender, shot, tone, build),
          1
        );
        const img = images[0];
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
