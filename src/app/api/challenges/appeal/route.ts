import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, CLAUDE_MODEL } from "@/lib/anthropic";
import {
  composeInstructions,
  PERSONAS,
  DEFAULT_PERSONA,
  isPersonaKey,
} from "@/lib/decider";

type AppealResult = {
  outcome: "upheld" | "harsher" | "mercy";
  reply: string;
  instruction: string;
  flavor: string;
  proof_required: boolean;
  proof_elements: string[];
};

function parseAppeal(text: string, fallback: AppealResult): AppealResult {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) return fallback;
    const j = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const outcome =
      j.outcome === "harsher" || j.outcome === "mercy" ? j.outcome : "upheld";
    return {
      outcome,
      reply:
        typeof j.reply === "string" && j.reply.trim()
          ? j.reply.trim()
          : fallback.reply,
      instruction:
        typeof j.instruction === "string" && j.instruction.trim()
          ? j.instruction.trim()
          : fallback.instruction,
      flavor: typeof j.flavor === "string" ? j.flavor.trim() : fallback.flavor,
      proof_required: !!j.proof_required,
      proof_elements: Array.isArray(j.proof_elements)
        ? j.proof_elements.filter((x): x is string => typeof x === "string")
        : [],
    };
  } catch {
    return fallback;
  }
}

export async function POST(request: Request) {
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
      { error: "Server is missing ANTHROPIC_API_KEY." },
      { status: 500 }
    );
  }

  const { challengeId, message } = (await request.json()) as {
    challengeId?: string;
    message?: string;
  };
  const plea = (message ?? "").trim().slice(0, 1000);
  if (!challengeId || !plea) {
    return NextResponse.json(
      { error: "Say what you want to put to the Decider." },
      { status: 400 }
    );
  }

  const { data: ch } = await supabase
    .from("bf_challenges")
    .select("*")
    .eq("id", challengeId)
    .single();
  if (!ch) {
    return NextResponse.json({ error: "Challenge not found." }, { status: 404 });
  }
  if (ch.status === "sealed") {
    return NextResponse.json(
      { error: "Open the envelope before you plead your case." },
      { status: 400 }
    );
  }
  if (ch.status !== "issued") {
    return NextResponse.json(
      { error: "This one's already settled." },
      { status: 400 }
    );
  }

  const { data: settings } = await supabase
    .from("bf_settings")
    .select("*")
    .maybeSingle();
  const personaRaw = settings?.persona;
  const persona = isPersonaKey(personaRaw) ? personaRaw : DEFAULT_PERSONA;
  const instructions = composeInstructions(
    settings?.base_instructions,
    settings?.custom_instructions
  );
  const today = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  const existingProof = Array.isArray(ch.proof_required_json)
    ? (ch.proof_required_json as string[])
    : [];

  const prompt = `${instructions}

Persona — write ALL player-facing text in this voice: ${PERSONAS[persona].voice}

The verdict you already issued to the owner:
- Instruction: ${ch.instruction}
- Flavour: ${ch.flavor ?? ""}
- Rarity tier: ${ch.rarity}
- ${
    existingProof.length
      ? `Photo proof required: ${existingProof.join("; ")}`
      : "No photo proof required."
  }

The owner is now reasoning with you / appealing. His words:
"${plea}"

Weigh his case against what you know of him. You decide the outcome — you are NOT a pushover, but you can be fair:
- UPHOLD it unchanged,
- make it HARSHER (e.g. if he's wriggling out of something reasonable, stalling, or being cheeky),
- or show MERCY (soften it, or swap it for something kinder).

Return ONLY a JSON object (no markdown), with exactly these keys:
{
  "outcome": "upheld" | "harsher" | "mercy",
  "reply": "your spoken response to him, in the persona voice, 1-3 sentences — address his point directly",
  "instruction": "the verdict as it now stands (repeat it unchanged if upheld)",
  "flavor": "one short line in the persona voice",
  "proof_required": true or false,
  "proof_elements": ["if proof_required and the act is genuinely daring, 2-5 things the photo must show — include the bare feet, an object proving the location/context, and today's date (${today}) written on the foot in pen; otherwise []"]
}`;

  const fallback: AppealResult = {
    outcome: "upheld",
    reply: "The verdict stands.",
    instruction: ch.instruction,
    flavor: ch.flavor ?? "",
    proof_required: existingProof.length > 0,
    proof_elements: existingProof,
  };

  let result = fallback;
  try {
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    });
    const text = msg.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    result = parseAppeal(text, fallback);
  } catch (err) {
    console.error("[appeal] anthropic error", err);
    const e = err as { status?: number; message?: string };
    return NextResponse.json(
      {
        error:
          e.status === 401
            ? "Anthropic key rejected — check the ANTHROPIC_API_KEY in Vercel."
            : e.message || "The Decider couldn't be reached.",
      },
      { status: 502 }
    );
  }

  const proofRequiredJson = result.proof_required ? result.proof_elements : null;

  await supabase
    .from("bf_challenges")
    .update({
      instruction: result.instruction,
      flavor: result.flavor,
      proof_required_json: proofRequiredJson,
    })
    .eq("id", challengeId);

  return NextResponse.json({
    outcome: result.outcome,
    reply: result.reply,
    instruction: result.instruction,
    flavor: result.flavor,
    proofRequired: result.proof_required,
    proofElements: result.proof_elements,
  });
}
