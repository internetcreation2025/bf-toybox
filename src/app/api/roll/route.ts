import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, CLAUDE_MODEL } from "@/lib/anthropic";
import {
  DEFAULT_WEIGHTS,
  rollRarity,
  rarityBrief,
  composeInstructions,
  footwearLine,
  PERSONAS,
  DEFAULT_PERSONA,
  isPersonaKey,
  type Rarity,
  type Dossier,
  type FootwearForRoll,
} from "@/lib/decider";

type Slot = { label: string; activity: string; location: string };
type FootwearItem = { id?: string; name: string; category: string };
type Wearing = { names: string[]; sockless: boolean };

type DiaryTask = { task: string; on: string };
type Authored = {
  instruction: string;
  flavor: string;
  proof_elements: string[];
  prep_tasks: string[];
  diary_tasks: DiaryTask[];
  gallery_demand: string;
  wear_refs: string[];
  sockless: boolean;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Format an ISO date without going through Date() (avoids timezone off-by-one).
function humanDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[(m || 1) - 1]} ${y}`;
}

const SPORT_RE =
  /\b(padel|paddle|racket\s?ball|racquet\s?ball|squash|tennis|badminton)\b/i;

function detectSport(schedule: Slot[]): string | null {
  for (const s of schedule) {
    const m = `${s.activity} ${s.label}`.match(SPORT_RE);
    if (m) return m[1].toLowerCase().replace(/\s+/g, "");
  }
  return null;
}

function parseAuthored(text: string, fallback: Authored): Authored {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) return fallback;
    const json = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const strings = (v: unknown): string[] =>
      Array.isArray(v)
        ? v
            .filter((x): x is string => typeof x === "string")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    return {
      instruction:
        typeof json.instruction === "string" && json.instruction.trim()
          ? json.instruction.trim()
          : fallback.instruction,
      flavor: typeof json.flavor === "string" ? json.flavor.trim() : fallback.flavor,
      proof_elements: Array.isArray(json.proof_elements)
        ? json.proof_elements.filter((x): x is string => typeof x === "string")
        : fallback.proof_elements,
      prep_tasks: strings(json.prep_tasks).slice(0, 3),
      diary_tasks: Array.isArray(json.diary_tasks)
        ? (json.diary_tasks as Array<Record<string, unknown>>)
            .filter(
              (d) =>
                typeof d?.task === "string" &&
                d.task.trim() &&
                typeof d?.on === "string" &&
                ISO_DATE.test(d.on)
            )
            .map((d) => ({ task: (d.task as string).trim(), on: d.on as string }))
            .slice(0, 3)
        : fallback.diary_tasks,
      gallery_demand:
        typeof json.gallery_demand === "string"
          ? json.gallery_demand.trim()
          : fallback.gallery_demand,
      wear_refs: strings(json.wear_refs).slice(0, 4),
      sockless: json.sockless === true,
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
    wearing?: Wearing;
    context?: string;
    smell?: number;
    date?: string;
    weatherLocation?: string;
    doubleOrNothing?: boolean;
    sealMinutes?: number;
  };
  const schedule = body.schedule ?? [];
  const footwear = body.footwear ?? [];
  const wearing: Wearing = {
    names: Array.isArray(body.wearing?.names)
      ? body.wearing.names.filter((n): n is string => typeof n === "string")
      : [],
    sockless: body.wearing?.sockless === true,
  };
  const context = (body.context ?? "").trim().slice(0, 2000);
  const weatherLocation = (body.weatherLocation ?? "").trim();
  const smell =
    typeof body.smell === "number" && body.smell >= 0 && body.smell <= 10
      ? Math.round(body.smell)
      : null;
  const sealMinutes =
    typeof body.sealMinutes === "number" && body.sealMinutes > 0
      ? Math.min(body.sealMinutes, 24 * 60)
      : 0;
  const sealedUntil = sealMinutes
    ? new Date(Date.now() + sealMinutes * 60000).toISOString()
    : null;

  if (
    schedule.length < 1 ||
    schedule.some(
      (s) => !s.label?.trim() || !s.activity?.trim() || !s.location?.trim()
    )
  ) {
    return NextResponse.json(
      { error: "Add at least one time block (time, activity and place)." },
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

  // The Decider's persistent memory + the losing streak.
  const { data: openMemory } = await supabase
    .from("bf_memory")
    .select("id, kind, title, sport, game_on")
    .eq("status", "open")
    .order("created_at", { ascending: true });
  const prepItems = (openMemory ?? []).filter((m) => m.kind === "prep");
  const gameItems = (openMemory ?? []).filter((m) => m.kind === "game");
  const diaryItems = (openMemory ?? []).filter((m) => m.kind === "diary");

  // Recent verdicts, so the Decider has continuity with Mike's history.
  const { data: recent } = await supabase
    .from("bf_challenges")
    .select("rarity, instruction, status")
    .order("created_at", { ascending: false })
    .limit(8);

  // The Roaster's "file": close-ups it demanded earlier and has on record.
  const isRoaster = persona === "roaster";
  const { data: galleryRows } = isRoaster
    ? await supabase
        .from("bf_gallery")
        .select("prompt, note, status")
        .eq("status", "filed")
        .order("filed_at", { ascending: false })
        .limit(6)
    : { data: null };
  const filedShots = (galleryRows ?? []).filter((g) => g.note?.trim());

  const { data: streakRow } = await supabase
    .from("bf_streak")
    .select("losing_streak")
    .maybeSingle();
  const losingStreak = streakRow?.losing_streak ?? 0;
  const revolting = losingStreak >= 3;
  const losingNote =
    losingStreak > 0
      ? `The owner is on a losing streak of ${losingStreak} disappointing game result(s). ${
          revolting
            ? "This dare must be genuinely revolting or obscure — push well past comfortable."
            : "Raise the daringness to match the frustration."
        }`
      : "";

  // Losing streak forces the spicier tiers, like a double-or-nothing.
  const forceSpicy = !!body.doubleOrNothing || losingStreak >= 2;
  const rarity = rollRarity(weights, forceSpicy);
  const brief = rarityBrief(rarity);
  const weather = await getWeather(weatherLocation || schedule[0]?.location);

  // Operative date for this roll — the owner can plan for a future day; defaults
  // to today. Used for the schedule context and the proof "date on foot".
  const actualIso = new Date().toISOString().slice(0, 10);
  const todayIso =
    typeof body.date === "string" && ISO_DATE.test(body.date)
      ? body.date
      : actualIso;
  const today = humanDate(todayIso);

  // If a competitive game is on the schedule, set a follow-up so a later
  // session asks how it went (dedup on sport + date).
  const sport = detectSport(schedule);
  if (sport && !gameItems.some((g) => g.sport === sport && g.game_on === todayIso)) {
    await supabase.from("bf_memory").insert({
      user_id: user.id,
      kind: "game",
      title: `How did the ${sport} on ${today} go?`,
      sport,
      game_on: todayIso,
    });
  }

  // Enrich the on-hand footwear with each item's dossier + live wear state from
  // the catalogue, and give each a short ref (F1, F2…) the Decider can point at.
  const { data: catalogueRows } = await supabase.from("bf_footwear").select("*");
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of (catalogueRows ?? []) as Array<Record<string, unknown>>) {
    if (typeof row.id === "string") byId.set(row.id, row);
  }
  const refMap = new Map<string, { id: string | null; name: string }>();
  const footwearLines: string[] = footwear.map((f, i) => {
    const ref = `F${i + 1}`;
    refMap.set(ref, { id: f.id ?? null, name: f.name });
    const row = f.id ? byId.get(f.id) : undefined;
    const item: FootwearForRoll = {
      id: f.id ?? ref,
      name: f.name,
      category: f.category,
      dossier: (row?.dossier as Dossier | null) ?? null,
      worn_hours: Number(row?.worn_hours) || 0,
      played_count: Number(row?.played_count) || 0,
      dried_count: Number(row?.dried_count) || 0,
      sockless_count: Number(row?.sockless_count) || 0,
    };
    return footwearLine(ref, item);
  });

  const prompt = `${instructions}

Persona — write ALL player-facing text in this voice: ${PERSONAS[persona].voice}

The owner's next 4 hours:
${schedule
  .map((s, i) => `${i + 1}. ${s.label} — ${s.activity} @ ${s.location}`)
  .join("\n")}

Footwear on hand right now (pick from these — use the wear state + dossier to choose well):
${footwearLines.join("\n")}
${
  wearing.names.length
    ? `Right now he's already wearing: ${wearing.names.join(", ")}${
        wearing.sockless ? " (no socks)" : ""
      }. Factor this in — tell him to keep them, change, or escalate.`
    : ""
}
${weather ? `Current weather near them: ${weather}` : ""}
${
  context
    ? `Notes from the owner (use these — they may include game results/performance, foot or sock state, mood, or something he prepped earlier and is now carrying): ${context}`
    : ""
}
${
  prepItems.length
    ? `Prep tasks you set in earlier sessions that are still open — reference or pay these off when the moment fits, and do not re-issue them: ${prepItems
        .map((p) => p.title)
        .join("; ")}`
    : ""
}
${
  diaryItems.length
    ? `Tasks you've already diarised for future dates — don't duplicate these; bring one to life when its day is here or near: ${diaryItems
        .map((d) => `${d.game_on}: ${d.title}`)
        .join("; ")}`
    : ""
}
${
  recent && recent.length
    ? `Your recent verdicts (newest first) — for continuity; don't just repeat them, build on or deliberately vary them: ${recent
        .map((r) => `[${r.rarity}/${r.status}] ${r.instruction}`)
        .join(" | ")}`
    : ""
}
${
  filedShots.length
    ? `YOUR FILE ON MIKE — close-ups you demanded earlier and keep on record. Reference these to needle him and to decide what's worth adding: ${filedShots
        .map((g) => `"${g.prompt}" — ${g.note}`)
        .join(" | ")}`
    : ""
}
${smell !== null ? `Current footwear/sock smell index the owner reports: ${smell}/10.` : ""}
${losingNote}
Today's date: ${today} (ISO ${todayIso})

Rolled rarity: ${rarity.toUpperCase()}. Tier directive: ${brief.guide}
Verdict type: ${brief.verdictType}. Photo proof required: ${brief.proofRequired}

Return ONLY a JSON object (no markdown, no commentary), with exactly these keys:
{
  "instruction": "one or two concrete sentences telling them what to do with their feet, tied to the actual schedule",
  "flavor": "one short punchy line in the persona voice",
  "proof_elements": ${
    brief.proofRequired
      ? `["2 to 5 specific things that must appear in the proof photo — include the bare feet, an object proving the location/context, and today's date (${today}) written on the foot in pen; state the expected foot condition (clean, or slightly dirty/sweaty); and if the dare hinges on condition, wear or smell, require a clear CLOSE-UP that shows it"]`
      : "[]"
  },
  "prep_tasks": ["zero or more short imperative tasks the owner must prepare DAYS IN ADVANCE for future sessions (e.g. 'Keep the sweaty socks from your next two padel games, dried and bagged, and carry them'); [] if none this round. Only set these on the more adventurous tiers."],
  "diary_tasks": [{ "task": "what he must do", "on": "YYYY-MM-DD on or after ${todayIso}" }],
  "gallery_demand": ${
    isRoaster
      ? `"OPTIONAL and SEPARATE from the dare — only occasionally, when you fancy it. One short, exacting demand for a single well-lit close-up of a specific part of Mike's bare foot, framed how you want it, purely to add to your file for future roasts (e.g. 'a tight, well-lit shot of the underside of your right big toe'). Empty string if you don't want one this round."`
      : `""`
  },
  "wear_refs": ["the ref label(s) like F1, F2 of the footwear AND socks you're telling him to wear this session — [] if none / not a wear verdict"],
  "sockless": "true if you're telling him to wear a shoe with NO socks, otherwise false"
}
(diary_tasks: zero or more tasks to schedule for a SPECIFIC future date — use [] if none; only diarise when it genuinely makes sense. gallery_demand: a standalone close-up request for the Roaster's file, NOT proof for the dare — leave it as "" unless you genuinely want a shot on record.)`;

  const fallback: Authored = {
    instruction: brief.guide,
    flavor: "",
    proof_elements: [],
    prep_tasks: [],
    diary_tasks: [],
    gallery_demand: "",
    wear_refs: [],
    sockless: false,
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

  // Resolve the Decider's wear picks (F1, F2…) back to real catalogue items so
  // "mark done" can log wear against them. Only items with a real id count.
  const wearItems = authored.wear_refs
    .map((r) => refMap.get(r.trim().toUpperCase()))
    .filter((x): x is { id: string | null; name: string } => !!x && !!x.id)
    .map((x) => ({ id: x.id as string, name: x.name }));
  const wearJson =
    wearItems.length || authored.sockless
      ? { items: wearItems, sockless: authored.sockless }
      : null;

  const baseRow = {
    user_id: user.id,
    schedule_json: schedule,
    available_footwear_json: footwear,
    weights_json: weights,
    verdict_type: brief.verdictType,
    rarity,
    instruction: authored.instruction,
    flavor: authored.flavor,
    proof_required_json: proofRequiredJson,
    status: sealedUntil ? "sealed" : "issued",
    sealed_until: sealedUntil,
  };

  // Try to store the wear picks; if the wear_json column isn't there yet
  // (migration not run), fall back so the roll still works.
  let inserted: { id: string } | null = null;
  {
    const { data, error } = await supabase
      .from("bf_challenges")
      .insert({ ...baseRow, wear_json: wearJson })
      .select("id")
      .single();
    if (error) {
      const { data: data2 } = await supabase
        .from("bf_challenges")
        .insert(baseRow)
        .select("id")
        .single();
      inserted = data2;
    } else {
      inserted = data;
    }
  }

  // Make sure a streak row exists for later phases (don't overwrite counts).
  await supabase
    .from("bf_streak")
    .upsert({ user_id: user.id }, { onConflict: "user_id", ignoreDuplicates: true });

  // Remember any prep-ahead tasks the Decider set. Skip when sealed so the
  // hidden verdict isn't spoiled on the dashboard.
  if (!sealedUntil && authored.prep_tasks.length) {
    await supabase.from("bf_memory").insert(
      authored.prep_tasks.map((t) => ({
        user_id: user.id,
        kind: "prep",
        title: t.slice(0, 300),
      }))
    );
  }

  // Diarised tasks land on a specific future date (stored in game_on).
  if (!sealedUntil && authored.diary_tasks.length) {
    await supabase.from("bf_memory").insert(
      authored.diary_tasks.map((d) => ({
        user_id: user.id,
        kind: "diary",
        title: d.task.slice(0, 300),
        game_on: d.on,
      }))
    );
  }

  // The Roaster occasionally demands a standalone close-up "for the file" —
  // logged as a pending gallery item Mike fulfils later. Never on sealed rolls.
  if (!sealedUntil && isRoaster && authored.gallery_demand) {
    await supabase.from("bf_gallery").insert({
      user_id: user.id,
      prompt: authored.gallery_demand.slice(0, 300),
    });
  }

  console.log("[roll] done", rarity, sealedUntil ? "(sealed)" : "");

  // Sealed: withhold the verdict entirely — the client only learns it exists
  // and when it unlocks. Content is fetched later via /api/envelope/open.
  if (sealedUntil) {
    return NextResponse.json({
      id: inserted?.id,
      sealed: true,
      sealedUntil,
    });
  }

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
