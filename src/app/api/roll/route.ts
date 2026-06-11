import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, CLAUDE_MODEL } from "@/lib/anthropic";
import {
  DEFAULT_WEIGHTS,
  rollRarity,
  rarityBrief,
  composeInstructions,
  PERSONAS,
  DEFAULT_PERSONA,
  isPersonaKey,
  type Rarity,
} from "@/lib/decider";

type Slot = { label: string; activity: string; location: string };
type FootwearItem = { name: string; category: string };

type Authored = { instruction: string; flavor: string; proof_elements: string[] };

function parseAuthored(text: string, fallback: Authored): Authored {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) return fallback;
    const json = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    return {
      instruction:
        typeof json.instruction === "string" && json.instruction.trim()
          ? json.instruction.trim()
          : fallback.instruction,
      flavor: typeof json.flavor === "string" ? json.flavor.trim() : fallback.flavor,
      proof_elements: Array.isArray(json.proof_elements)
        ? json.proof_elements.filter((x): x is string => typeof x === "string")
        : fallback.proof_elements,
    };
  } catch {
    return fallback;
  }
}

async function getWeather(location: string | undefined): Promise<string | null> {
  const key = process.env.OPENWEATHER_API_KEY;
  if (!key || !location) return null;
  try {
    const geo = await fetch(
      `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(
        location
      )}&limit=1&appid=${key}`
    ).then((r) => r.json());
    const place = Array.isArray(geo) ? geo[0] : null;
    if (!place) return null;
    const w = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${place.lat}&lon=${place.lon}&units=metric&appid=${key}`
    ).then((r) => r.json());
    if (!w?.weather?.[0]) return null;
    return `${w.weather[0].description}, ${Math.round(w.main.temp)}°C`;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  console.log("[roll] start");

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

  const body = (await request.json()) as {
    schedule?: Slot[];
    footwear?: FootwearItem[];
    doubleOrNothing?: boolean;
  };
  const schedule = body.schedule ?? [];
  const footwear = body.footwear ?? [];

  if (
    schedule.length < 4 ||
    schedule.some((s) => !s.activity?.trim() || !s.location?.trim())
  ) {
    return NextResponse.json(
      { error: "Fill in all four hours — no gaps." },
      { status: 400 }
    );
  }
  if (footwear.length === 0) {
    return NextResponse.json(
      { error: "Pick at least one item you have on hand." },
      { status: 400 }
    );
  }

  const { data: settings } = await supabase
    .from("bf_settings")
    .select("*")
    .maybeSingle();

  const personaRaw = settings?.persona;
  const persona = isPersonaKey(personaRaw) ? personaRaw : DEFAULT_PERSONA;
  const weights =
    (settings?.weights_json as Record<Rarity, number> | null) ?? DEFAULT_WEIGHTS;
  const instructions = composeInstructions(
    settings?.base_instructions,
    settings?.custom_instructions
  );

  const rarity = rollRarity(weights, !!body.doubleOrNothing);
  const brief = rarityBrief(rarity);
  const weather = await getWeather(schedule[0]?.location);
  const today = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  const prompt = `${instructions}

Persona — write ALL player-facing text in this voice: ${PERSONAS[persona].voice}

The owner's next 4 hours:
${schedule
  .map((s, i) => `${i + 1}. ${s.label} — ${s.activity} @ ${s.location}`)
  .join("\n")}

Footwear on hand right now: ${footwear
    .map((f) => `${f.name} (${f.category})`)
    .join(", ")}
${weather ? `Current weather near them: ${weather}` : ""}
Today's date: ${today}

Rolled rarity: ${rarity.toUpperCase()}. Tier directive: ${brief.guide}
Verdict type: ${brief.verdictType}. Photo proof required: ${brief.proofRequired}

Return ONLY a JSON object (no markdown, no commentary), with exactly these keys:
{
  "instruction": "one or two concrete sentences telling them what to do with their feet, tied to the actual schedule",
  "flavor": "one short punchy line in the persona voice",
  "proof_elements": ${
    brief.proofRequired
      ? `["2 to 4 specific things that must appear in the proof photo — include the tops of the bare feet, an object proving the schedule location/context, and today's date (${today}) written on the foot in pen"]`
      : "[]"
  }
}`;

  const fallback: Authored = {
    instruction: brief.guide,
    flavor: "",
    proof_elements: [],
  };
  let authored = fallback;
  try {
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 700,
      messages: [{ role: "user", content: prompt }],
    });
    const text = msg.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    authored = parseAuthored(text, fallback);
  } catch (err) {
    console.error("[roll] anthropic error", err);
    const e = err as { status?: number; message?: string };
    const m =
      e.status === 401
        ? "Anthropic key rejected — check the ANTHROPIC_API_KEY in Vercel."
        : e.message || "AI request failed";
    return NextResponse.json({ error: m }, { status: 502 });
  }

  const proofRequiredJson = brief.proofRequired ? authored.proof_elements : null;

  const { data: inserted } = await supabase
    .from("bf_challenges")
    .insert({
      user_id: user.id,
      schedule_json: schedule,
      available_footwear_json: footwear,
      weights_json: weights,
      verdict_type: brief.verdictType,
      rarity,
      instruction: authored.instruction,
      flavor: authored.flavor,
      proof_required_json: proofRequiredJson,
      status: "issued",
    })
    .select("id")
    .single();

  // Make sure a streak row exists for later phases (don't overwrite counts).
  await supabase
    .from("bf_streak")
    .upsert({ user_id: user.id }, { onConflict: "user_id", ignoreDuplicates: true });

  console.log("[roll] done", rarity);
  return NextResponse.json({
    id: inserted?.id,
    rarity,
    verdictType: brief.verdictType,
    instruction: authored.instruction,
    flavor: authored.flavor,
    proofRequired: brief.proofRequired,
    proofElements: authored.proof_elements,
    today,
  });
}
