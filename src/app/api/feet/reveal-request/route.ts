import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, CLAUDE_MODEL } from "@/lib/anthropic";
import { DECIDER_VOICE } from "@/lib/decider";

// On a whim, the Decider asks to SEE his feet right now — sometimes the whole
// bare foot, sometimes one specific part. He proves it with a photo (verified +
// logged separately). Doing it somewhere awkward is the whole thrill.
export async function POST(request: Request) {
  console.log("[feet/reveal-request] start");

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

  const { location, nowLabel } = (await request.json().catch(() => ({}))) as {
    location?: string;
    nowLabel?: string;
  };

  // Known landmark spots she can target specifically.
  const { data: details } = await supabase
    .from("bf_foot_refs")
    .select("label")
    .eq("angle", "detail");
  const spots = Array.from(
    new Set(
      (details ?? [])
        .map((d) => (d.label as string | null)?.trim())
        .filter((l): l is string => !!l)
    )
  );

  let ask = "";
  try {
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 120,
      messages: [
        {
          role: "user",
          content: `You are ${DECIDER_VOICE}

Right now you want to SEE his feet — ask him to get a foot out and show you, with a photo, this instant. Sometimes ask for a whole bare foot or both; sometimes zero in on one specific part (a particular toe, the sole, a heel, the gap between two toes).${
            spots.length ? ` Landmark spots you know: ${spots.join("; ")}.` : ""
          }
${nowLabel ? `It's ${nowLabel}.` : ""}${location ? ` He's at: ${location}.` : ""}
Give ONE short instruction, in your voice, naming exactly what to show — one or two sentences, no preamble, no markdown.`,
        },
      ],
    });
    ask = msg.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim()
      .slice(0, 300);
  } catch (err) {
    console.error("[feet/reveal-request] anthropic error", err);
    const e = err as { status?: number; message?: string };
    const m =
      e.status === 401
        ? "Anthropic key rejected — check the ANTHROPIC_API_KEY in Vercel."
        : e.message || "AI request failed";
    return NextResponse.json({ error: m }, { status: 502 });
  }

  if (!ask) ask = "Get a bare foot out and show me the sole, right now.";
  console.log("[feet/reveal-request] done");
  return NextResponse.json({ request: ask });
}
