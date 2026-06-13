import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, CLAUDE_MODEL } from "@/lib/anthropic";
import {
  composeInstructions,
  footwearLine,
  rarityBrief,
  DECIDER_VOICE,
  type Rarity,
  type Dossier,
  type FootwearForRoll,
  type PlanStep,
} from "@/lib/decider";

type Slot = { label: string; activity: string; location: string };

// Targeted amend: the owner's plans shifted while a roll is in play. We re-plan
// ONLY the blocks that changed (plus the steps that lead in and out of them),
// keeping the same rolled tier, the same headline, and every other step intact.
export async function POST(request: Request) {
  console.log("[challenges/amend] start");

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

  const { challengeId, schedule } = (await request.json()) as {
    challengeId?: string;
    schedule?: Slot[];
  };
  const newSchedule = (schedule ?? []).filter(
    (s) => s.label?.trim() && s.activity?.trim()
  );
  if (!challengeId || newSchedule.length === 0) {
    return NextResponse.json(
      { error: "Need the challenge and at least one block (time + activity)." },
      { status: 400 }
    );
  }

  const { data: ch, error } = await supabase
    .from("bf_challenges")
    .select("*")
    .eq("id", challengeId)
    .single();
  if (error || !ch) {
    return NextResponse.json({ error: "Challenge not found." }, { status: 404 });
  }
  if (ch.status === "sealed") {
    return NextResponse.json(
      { error: "Open the sealed envelope first, then you can adjust it." },
      { status: 400 }
    );
  }
  if (ch.status !== "issued") {
    return NextResponse.json(
      { error: "This roll is no longer in play." },
      { status: 400 }
    );
  }

  const rarity = ch.rarity as Rarity;
  const brief = rarityBrief(rarity);
  const proofRequired = Array.isArray(ch.proof_required_json);
  const oldSchedule = (ch.schedule_json as Slot[] | null) ?? [];
  const currentPlan = (ch.plan_json as {
    steps?: PlanStep[];
    before?: string;
    carryover?: string;
  } | null) ?? null;

  // Persona + the owner's editable brief, exactly as the roll uses them.
  const { data: settings } = await supabase
    .from("bf_settings")
    .select("*")
    .maybeSingle();
  const instructions = composeInstructions(
    settings?.base_instructions,
    settings?.custom_instructions
  );

  // Footwear lines (dossier + wear state) for the items offered at roll time.
  const offered = (ch.available_footwear_json as Array<{
    id?: string;
    name: string;
    category: string;
  }> | null) ?? [];
  const { data: catalogueRows } = await supabase
    .from("bf_footwear")
    .select("*");
  const byId = new Map<string, Record<string, unknown>>();
  for (const r of catalogueRows ?? []) byId.set(r.id as string, r);
  const footwearLines = offered.map((f, i) => {
    const ref = `F${i + 1}`;
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
    };
    return footwearLine(ref, item);
  });

  const fmtSchedule = (rows: Slot[]) =>
    rows
      .map(
        (s, i) =>
          `${i + 1}. ${s.label} — ${s.activity}${
            s.location?.trim() ? ` @ ${s.location.trim()}` : ""
          }`
      )
      .join("\n");

  const nowLabel = new Date().toLocaleString("en-GB", {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
  });

  const prompt = `${instructions}

Persona — write ALL player-facing text in this voice: ${DECIDER_VOICE}

You are AMENDING a verdict that is already IN PLAY — the owner's day shifted, so his schedule changed. Do NOT start over and do NOT re-roll: keep the same rolled tier (${rarity.toUpperCase()}) and the same headline/bonus moment. Revise ONLY the part of the plan affected by the change — the block(s) that were added, removed, retimed, moved or re-described, plus any step immediately before or after whose prep or carry-over depends on it. Leave every other step EXACTLY as it was, word for word. If the block that WAS the headline is gone or changed beyond recognition, move the headline to the most fitting remaining block at the same tier; otherwise keep it where it is. Photo proof requirement stays ${proofRequired ? "ON (keep proof elements about the headline)" : "OFF"}.

Tier directive (unchanged): ${brief.guide}

RIGHT NOW it is ${nowLabel}. Blocks already in the past are context/carry-over — don't re-prescribe them.

PREVIOUS schedule:
${fmtSchedule(oldSchedule) || "(none recorded)"}

NEW schedule (this is the truth now):
${fmtSchedule(newSchedule)}

The CURRENT plan you are revising (keep unaffected steps verbatim):
${JSON.stringify(
  {
    before: currentPlan?.before ?? "",
    steps: currentPlan?.steps ?? [],
    carryover: currentPlan?.carryover ?? "",
  },
  null,
  2
)}

Footwear on hand (same as the original roll — reuse these [F#] items):
${footwearLines.join("\n")}

Return ONLY a JSON object (no markdown), with exactly these keys — the FULL revised plan, not just the changed parts:
{
  "instruction": "one or two sentences summarising the headline moment (update only if the headline changed)",
  "flavor": "the day's one-line theme in the persona voice (keep the original unless the change warrants a tweak)",
  "before": "pre-day prep / carry-over — empty string if none",
  "plan": [ { "when": "time label", "activity": "activity + place", "do": "what to wear and prep", "after": "what to do straight after — omit key if nothing", "headline": false } ],
  "carryover": "the through-line across the day — empty string if none"${
    proofRequired
      ? ',\n  "proof_elements": ["2 to 5 specific things the proof photo must show for the headline — bare feet, an object proving the location/context, today\'s date written on the foot in pen; a close-up if condition/wear/smell is the point"]'
      : ""
  }
}`;

  let parsed: {
    instruction: string;
    flavor: string;
    plan: PlanStep[];
    before: string;
    carryover: string;
    proof_elements: string[];
  };
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
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    const json = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    parsed = {
      instruction:
        typeof json.instruction === "string" && json.instruction.trim()
          ? json.instruction.trim()
          : (ch.instruction as string),
      flavor:
        typeof json.flavor === "string" && json.flavor.trim()
          ? json.flavor.trim()
          : (ch.flavor as string) ?? "",
      before: typeof json.before === "string" ? json.before.trim() : "",
      carryover: typeof json.carryover === "string" ? json.carryover.trim() : "",
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
        : (currentPlan?.steps ?? []),
      proof_elements: Array.isArray(json.proof_elements)
        ? json.proof_elements.filter((x): x is string => typeof x === "string")
        : proofRequired
        ? (ch.proof_required_json as string[])
        : [],
    };
  } catch (err) {
    console.error("[challenges/amend] anthropic error", err);
    const e = err as { status?: number; message?: string };
    const m =
      e.status === 401
        ? "Anthropic key rejected — check the ANTHROPIC_API_KEY in Vercel."
        : e.message || "AI request failed";
    return NextResponse.json({ error: m }, { status: 502 });
  }

  const planJson = {
    steps: parsed.plan,
    before: parsed.before,
    carryover: parsed.carryover,
  };

  // Persist the revision. plan_json may not exist pre-migration — fall back.
  const update: Record<string, unknown> = {
    schedule_json: newSchedule,
    instruction: parsed.instruction,
    flavor: parsed.flavor,
  };
  if (proofRequired) update.proof_required_json = parsed.proof_elements;

  const { error: upErr } = await supabase
    .from("bf_challenges")
    .update({ ...update, plan_json: planJson })
    .eq("id", challengeId);
  if (upErr) {
    await supabase.from("bf_challenges").update(update).eq("id", challengeId);
  }

  console.log("[challenges/amend] done");
  return NextResponse.json({
    instruction: parsed.instruction,
    flavor: parsed.flavor,
    plan: parsed.plan,
    before: parsed.before,
    carryover: parsed.carryover,
    proofRequired,
    proofElements: parsed.proof_elements,
  });
}
