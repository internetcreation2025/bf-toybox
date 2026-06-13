import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, CLAUDE_MODEL } from "@/lib/anthropic";
import {
  DEFAULT_WEIGHTS,
  rollRarity,
  rarityBrief,
  composeInstructions,
  footwearLine,
  normalityBlock,
  PERSONAS,
  DEFAULT_PERSONA,
  isPersonaKey,
  type Rarity,
  type Dossier,
  type FootwearForRoll,
  type PlanStep,
} from "@/lib/decider";

type Slot = { label: string; activity: string; location: string };
type FootwearItem = { id?: string; name: string; category: string };
type Wearing = { names: string[]; sockless: boolean };

type DiaryTask = { task: string; on: string };
type Authored = {
  instruction: string;
  flavor: string;
  plan: PlanStep[];
  before: string;
  carryover: string;
  proof_elements: string[];
  prep_tasks: string[];
  diary_tasks: DiaryTask[];
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
      plan: Array.isArray(json.plan)
        ? (json.plan as Array<Record<string, unknown>>)
            .filter((s) => typeof s?.do === "string" && (s.do as string).trim())
            .map((s) => ({
              when: typeof s.when === "string" ? s.when.trim() : "",
              activity: typeof s.activity === "string" ? s.activity.trim() : "",
              do: (s.do as string).trim(),
              after:
                typeof s.after === "string" && s.after.trim()
                  ? s.after.trim()
                  : undefined,
              headline: s.headline === true,
            }))
            .slice(0, 12)
        : fallback.plan,
      before: typeof json.before === "string" ? json.before.trim() : fallback.before,
      carryover:
        typeof json.carryover === "string" ? json.carryover.trim() : fallback.carryover,
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
    nowLabel?: string;
    clientToday?: string;
    wholeDay?: boolean;
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
    schedule.some((s) => !s.label?.trim() || !s.activity?.trim())
  ) {
    return NextResponse.json(
      { error: "Add at least one time block (time and activity)." },
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

  // Labelled foot landmarks — specific spots he's given reference close-ups of.
  const { data: landmarkRows } = await supabase
    .from("bf_foot_refs")
    .select("label")
    .not("label", "is", null);
  const landmarks = (landmarkRows ?? [])
    .map((r) => (r.label as string | null)?.trim())
    .filter((x): x is string => !!x);

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

  // Time awareness: compare the schedule's date (and, if it's today, the current
  // clock time) against now, so the Decider knows what's done, in play, or still
  // ahead and prescribes accordingly.
  const clientToday =
    typeof body.clientToday === "string" && ISO_DATE.test(body.clientToday)
      ? body.clientToday
      : actualIso;
  const nowLabel = (body.nowLabel ?? "").toString().trim().slice(0, 60);
  let timeContext: string;
  if (todayIso === clientToday) {
    timeContext = nowLabel
      ? `TIME AWARENESS — today is ${clientToday} and right now it is ${nowLabel}. You KNOW the current date and time; never prescribe footwear for a moment that has already passed. Compare each block's time against now: blocks earlier than now have ALREADY HAPPENED — do NOT give forward instructions for them. For a passed block you have a choice, and should VARY it (sometimes do this, often don't): occasionally turn that block into a brief RETROSPECTIVE question instead — ask Mike what he actually did with his feet/socks/footwear during that earlier part of the day (set it as the step's instruction, phrased as a question) — otherwise just treat it as context/carry-over and move on. The block spanning now is IN PLAY; put your real prescriptions on what's happening now and everything still to come, laid out precisely in order. If the whole day is already behind him, make it a wrap-up for the rest of the evening.`
      : `TIME AWARENESS — this schedule is for TODAY; weight your prescriptions toward what is still ahead.`;
  } else if (todayIso > clientToday) {
    timeContext = `TIME AWARENESS — this schedule is for a FUTURE day; the whole day is still ahead, so plan it from the start.`;
  } else {
    timeContext = `TIME AWARENESS — this schedule is for a PAST day; treat it as a retrospective record rather than live instructions.`;
  }

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
  const refMap = new Map<
    string,
    { id: string | null; name: string; category: string }
  >();
  const footwearLines: string[] = footwear.map((f, i) => {
    const ref = `F${i + 1}`;
    refMap.set(ref, { id: f.id ?? null, name: f.name, category: f.category });
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
      sockless_ok: (row?.sockless_ok as boolean | null | undefined) ?? null,
      label: (row?.label as string | null | undefined) ?? null,
      retired: (row?.retired as boolean | null | undefined) ?? null,
      last_worn_at: (row?.last_worn_at as string | null | undefined) ?? null,
      description: (row?.description as string | null | undefined) ?? null,
    };
    return footwearLine(ref, item);
  });

  const prompt = `${instructions}

Persona — write ALL player-facing text in this voice: ${PERSONAS[persona].voice}

${normalityBlock(settings?.normality as string | null | undefined)}
${
  body.wholeDay
    ? `\nWHOLE-DAY PLAN — the schedule below is his ENTIRE day, pulled from his calendar. Cover it from morning to night, in order. Any gap, or any stretch with no entry, means he is at home (socks or barefoot, as fits). He sleeps barefoot roughly 11pm–7am, so you may bookend the plan with winding down to bed and waking. Give him the day's footwear decisions across the whole day, not just one moment.\n`
    : ""
}
The owner's schedule:
${schedule
  .map(
    (s, i) =>
      `${i + 1}. ${s.label} — ${s.activity}${
        s.location?.trim() ? ` @ ${s.location.trim()}` : " (place not given — assume home base)"
      }`
  )
  .join("\n")}

${timeContext}

Footwear on hand right now (pick from these — use the wear state + dossier to choose well). Each line starts with a bracketed code like [F1] — that code is FOR YOUR INTERNAL USE ONLY (the "wear_refs" field). NEVER write a [F#] code in any text Mike reads. In everything he sees, name a SHOE by its description/name and a SOCK by its written label only (e.g. "S2"); never show the code, and don't refer to a sock by anything but its label:
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
  landmarks.length
    ? `KNOWN FOOT LANDMARKS — you hold labelled reference close-ups of these exact spots on his feet. You may name them specifically, demand a fresh close-up of one as proof or for the file, and target foot-care there: ${landmarks.join("; ")}`
    : ""
}
${smell !== null ? `Current footwear/sock smell index the owner reports: ${smell}/10.` : ""}
${losingNote}
Today's date: ${today} (ISO ${todayIso})

Rolled rarity: ${rarity.toUpperCase()}. Tier directive: ${brief.guide}
Verdict type: ${brief.verdictType}. Photo proof required: ${brief.proofRequired}

BUILD A CHRONOLOGICAL DAY PLAN — do NOT collapse the day into a single moment. Walk his schedule IN ORDER, one step per block, covering EVERY block (even mundane ones, briefly). For each block say what to wear — name the shoes by their description and the socks by their written label (or sockless) — and how to prep for it, and in "after" what to do with his feet/socks straight afterwards to hand over into the next block — thread the CARRY-OVER through the day (e.g. keep the damp padel socks bagged, slip shoes on sockless for the drive, bring them in at the end). Mark ONE block (occasionally two) with "headline": true — the standout/bonus moment that carries the rolled tier's daringness; any photo proof is about that headline moment. The "instruction" field should summarise that headline moment in one or two sentences (it's what shows in the archive and on the proof screen).

Return ONLY a JSON object (no markdown, no commentary), with exactly these keys:
{
  "instruction": "one or two sentences summarising the standout/headline moment of the plan (used in the archive + proof screen)",
  "flavor": "one short punchy line in the persona voice, the theme of the whole day",
  "before": "anything to prepare BEFORE the day starts, or carried over from earlier (e.g. socks you bagged last week) — empty string if none",
  "plan": [
    { "when": "time label for this block, e.g. 1–2pm", "activity": "the activity and place", "do": "what to wear (shoes by description, socks by their label, or sockless) and how to prep for it — NO [F#] codes", "after": "what to do with feet/socks straight after this block to set up the next — keep/air/bag/change/carry; omit the key if nothing", "headline": false }
  ],
  "carryover": "the through-line carried across the whole day and how it ends — empty string if none",
  "proof_elements": ${
    brief.proofRequired
      ? `["2 to 5 specific things that must appear in the proof photo — include the bare feet, an object proving the location/context, and today's date (${today}) written on the foot in pen; state the expected foot condition (clean, or slightly dirty/sweaty); and if the dare hinges on condition, wear or smell, require a clear CLOSE-UP that shows it"]`
      : "[]"
  },
  "prep_tasks": ["zero or more short imperative tasks the owner must prepare DAYS IN ADVANCE for future sessions (e.g. 'Keep the sweaty socks from your next two padel games, dried and bagged, and carry them'); [] if none this round. Only set these on the more adventurous tiers."],
  "diary_tasks": [{ "task": "what he must do", "on": "YYYY-MM-DD on or after ${todayIso}" }],
  "wear_refs": ["the ref label(s) like F1, F2 of the footwear AND socks you're telling him to wear this session — [] if none / not a wear verdict"],
  "sockless": "true if you're telling him to wear a shoe with NO socks, otherwise false"
}
(diary_tasks: zero or more tasks to schedule for a SPECIFIC future date — use [] if none; only diarise when it genuinely makes sense.)`;

  const fallback: Authored = {
    instruction: brief.guide,
    flavor: "",
    plan: [],
    before: "",
    carryover: "",
    proof_elements: [],
    prep_tasks: [],
    diary_tasks: [],
    wear_refs: [],
    sockless: false,
  };
  let authored = fallback;
  try {
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1500,
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
    .filter(
      (x): x is { id: string; name: string; category: string } => !!x && !!x.id
    )
    .map((x) => ({ id: x.id, name: x.name, category: x.category }));
  const wearJson =
    wearItems.length || authored.sockless
      ? { items: wearItems, sockless: authored.sockless }
      : null;

  // The chronological day plan (stored separately so the card can re-render it
  // later, e.g. from a sealed envelope or the archive).
  const planJson =
    authored.plan.length || authored.before || authored.carryover
      ? {
          steps: authored.plan,
          before: authored.before,
          carryover: authored.carryover,
        }
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

  // Try to store the wear picks + day plan; if those columns aren't there yet
  // (migration not run), fall back step by step so the roll still works.
  let inserted: { id: string } | null = null;
  {
    const attempts = [
      { ...baseRow, wear_json: wearJson, plan_json: planJson },
      { ...baseRow, wear_json: wearJson },
      baseRow,
    ];
    for (const payload of attempts) {
      const { data, error } = await supabase
        .from("bf_challenges")
        .insert(payload)
        .select("id")
        .single();
      if (!error && data) {
        inserted = data;
        break;
      }
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
    plan: authored.plan,
    before: authored.before,
    carryover: authored.carryover,
    proofRequired: brief.proofRequired,
    proofElements: authored.proof_elements,
    today,
  });
}
