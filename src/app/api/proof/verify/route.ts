import { NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { anthropic, CLAUDE_MODEL, sniffImageType } from "@/lib/anthropic";

// Angles that best show the tops of the bare feet — preferred as visual
// references when matching a proof photo.
const PREFERRED_REF_ANGLES = ["both_above", "top_left", "top_right"];

type ElementCheck = { name: string; present: boolean };
type Verification = {
  is_owner_feet: boolean;
  match_confidence: number;
  required_elements: ElementCheck[];
  verdict: "pass" | "fail";
  reasoning: string;
};

function clampConfidence(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function parseVerification(
  text: string,
  requiredNames: string[]
): Verification {
  const fallback: Verification = {
    is_owner_feet: false,
    match_confidence: 0,
    required_elements: requiredNames.map((name) => ({ name, present: false })),
    verdict: "fail",
    reasoning: "The verifier could not read a clear result from the photo.",
  };
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) return fallback;
    const json = JSON.parse(text.slice(start, end + 1)) as Record<
      string,
      unknown
    >;

    // Map Claude's element findings back onto the required list by name so the
    // shape is always exactly what the challenge asked for.
    const reported = Array.isArray(json.required_elements)
      ? (json.required_elements as Array<Record<string, unknown>>)
      : [];
    const findPresent = (name: string): boolean => {
      const hit = reported.find(
        (r) =>
          typeof r?.name === "string" &&
          r.name.trim().toLowerCase() === name.trim().toLowerCase()
      );
      return !!hit?.present;
    };
    const required_elements: ElementCheck[] = requiredNames.length
      ? requiredNames.map((name) => ({ name, present: findPresent(name) }))
      : reported
          .filter((r): r is { name: string; present?: unknown } =>
            typeof r?.name === "string"
          )
          .map((r) => ({ name: r.name, present: !!r.present }));

    return {
      is_owner_feet: !!json.is_owner_feet,
      match_confidence: clampConfidence(json.match_confidence),
      required_elements,
      verdict: json.verdict === "pass" ? "pass" : "fail",
      reasoning:
        typeof json.reasoning === "string" && json.reasoning.trim()
          ? json.reasoning.trim()
          : fallback.reasoning,
    };
  } catch {
    return fallback;
  }
}

export async function POST(request: Request) {
  console.log("[proof/verify] start");

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

  const { challengeId } = (await request.json()) as { challengeId?: string };
  if (!challengeId) {
    return NextResponse.json({ error: "challengeId required" }, { status: 400 });
  }

  const { data: challenge, error: chErr } = await supabase
    .from("bf_challenges")
    .select("*")
    .eq("id", challengeId)
    .single();
  if (chErr || !challenge) {
    return NextResponse.json({ error: "Challenge not found." }, { status: 404 });
  }
  if (!challenge.proof_photo_path) {
    return NextResponse.json(
      { error: "No proof photo uploaded yet." },
      { status: 400 }
    );
  }

  // Download the freshly-uploaded proof photo.
  const { data: proofFile, error: dlErr } = await supabase.storage
    .from("bf-feet")
    .download(challenge.proof_photo_path);
  if (dlErr || !proofFile) {
    return NextResponse.json(
      { error: `Proof image download failed: ${dlErr?.message ?? "unknown"}` },
      { status: 500 }
    );
  }
  const proofBuf = Buffer.from(await proofFile.arrayBuffer());
  const proofType = sniffImageType(proofBuf);
  if (!proofType) {
    return NextResponse.json(
      {
        error:
          "That image format isn't supported (HEIC photos can't be read). Please upload a JPEG or PNG — on iPhone, Settings → Camera → Formats → Most Compatible.",
      },
      { status: 400 }
    );
  }
  const proofB64 = proofBuf.toString("base64");

  // Gather the app's visual memory: textual fingerprints + a few reference
  // images that show the tops of the feet.
  const { data: refs } = await supabase
    .from("bf_foot_refs")
    .select("angle, photo_path, ai_fingerprint, label");

  const fingerprintRows = (refs ?? []).filter((r) => r.ai_fingerprint?.trim());
  if (fingerprintRows.length === 0) {
    return NextResponse.json(
      {
        error:
          "No learned foot references yet. Add at least one photo under “Teach it my feet” first.",
      },
      { status: 400 }
    );
  }

  // With several photos per angle this list can grow; cap it so the prompt
  // stays sane.
  const fingerprintText = fingerprintRows
    .slice(0, 10)
    .map(
      (r) =>
        `${r.label ? `Spot "${r.label}"` : `Angle "${r.angle}"`}:\n${r.ai_fingerprint}`
    )
    .join("\n\n");

  // Pick up to 3 reference images, preferring top-of-foot angles.
  const orderedRefs = [...fingerprintRows].sort((a, b) => {
    const ai = PREFERRED_REF_ANGLES.indexOf(a.angle);
    const bi = PREFERRED_REF_ANGLES.indexOf(b.angle);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  const refImages: Array<{ angle: string; media_type: string; data: string }> =
    [];
  for (const r of orderedRefs.slice(0, 3)) {
    const { data: f } = await supabase.storage
      .from("bf-feet")
      .download(r.photo_path);
    if (!f) continue;
    const buf = Buffer.from(await f.arrayBuffer());
    const t = sniffImageType(buf);
    if (!t) continue;
    refImages.push({ angle: r.angle, media_type: t, data: buf.toString("base64") });
  }

  const baseRequired: string[] = Array.isArray(challenge.proof_required_json)
    ? (challenge.proof_required_json as unknown[]).filter(
        (x): x is string => typeof x === "string"
      )
    : [];

  // T16 — if the dare names a catalogued sock by its written label (e.g. "S1a",
  // "D2b"), the proof must show that exact label, the right way up. The label
  // sits upright when the sock is on the foot and he's standing.
  const { data: labelledSocks } = await supabase
    .from("bf_footwear")
    .select("label")
    .eq("category", "socks")
    .not("label", "is", null);
  const instruction = (challenge.instruction ?? "") as string;
  const referencedLabels = (labelledSocks ?? [])
    .map((s) => (s.label as string | null)?.trim())
    .filter((l): l is string => !!l)
    .filter((l) =>
      new RegExp(`\\b${l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(
        instruction
      )
    );
  const labelChecks = referencedLabels.map(
    (l) => `Sock label "${l}" is visible and the right way up`
  );
  const requiredNames = [...baseRequired, ...labelChecks];

  // Build the multimodal verification message.
  const content: Anthropic.ContentBlockParam[] = [];
  for (const r of refImages) {
    content.push({
      type: "text",
      text: `REFERENCE photo of the owner's own foot (angle: ${r.angle}):`,
    });
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: r.media_type as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
        data: r.data,
      },
    });
  }
  content.push({
    type: "text",
    text: `Stored visual fingerprints of the owner's feet:\n\n${fingerprintText}`,
  });
  content.push({
    type: "text",
    text: "PROOF photo submitted right now — this is the image to verify:",
  });
  content.push({
    type: "image",
    source: { type: "base64", media_type: proofType, data: proofB64 },
  });
  content.push({
    type: "text",
    text: `You are the forensic verifier for a private footwear dare game.

The owner was set this dare:
"${challenge.instruction}"

Verify the PROOF photo against the owner's known feet and the dare's required elements.

1. Decide if the bare feet in the PROOF photo are the SAME person's feet as the references/fingerprints. Use stable features (toe ordering, nail shape, moles/scars, proportions) — ignore lighting and angle. Be strict but fair.
2. Give a match confidence from 0 to 100.
3. For EACH required element below, decide if it is clearly present in the proof photo.
${
  labelChecks.length
    ? `\nNOTE ON SOCK LABELS: each catalogued sock has a small hand-written code on it. When the sock is on the foot and the owner is standing, that code reads upright. For any "Sock label ... visible and the right way up" element, mark it present ONLY if you can actually read that exact code in the proof AND it is oriented upright (not upside-down or sideways). Read it the right way up.\n`
    : ""
}
Required elements:
${requiredNames.length ? requiredNames.map((n, i) => `${i + 1}. ${n}`).join("\n") : "(none specified)"}

Return ONLY a JSON object (no markdown, no commentary) with exactly these keys:
{
  "is_owner_feet": true or false,
  "match_confidence": 0-100,
  "required_elements": [${requiredNames
    .map((n) => `{ "name": ${JSON.stringify(n)}, "present": true or false }`)
    .join(", ")}],
  "verdict": "pass" or "fail",
  "reasoning": "2-3 sentences: what matched, what was missing, and why."
}`,
  });

  let verification: Verification;
  try {
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1200,
      messages: [{ role: "user", content }],
    });
    const text = msg.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    verification = parseVerification(text, requiredNames);
  } catch (err) {
    console.error("[proof/verify] anthropic error", err);
    const e = err as { status?: number; message?: string };
    const m =
      e.status === 401
        ? "Anthropic key rejected — check the ANTHROPIC_API_KEY in Vercel."
        : e.message || "AI request failed";
    return NextResponse.json({ error: m }, { status: 502 });
  }

  // Server-authoritative pass: the feet must match with reasonable confidence
  // AND every required element must be present. Never just trust the model's
  // own "verdict" field.
  const allElementsPresent = verification.required_elements.every(
    (e) => e.present
  );
  const passed =
    verification.is_owner_feet &&
    verification.match_confidence >= 60 &&
    allElementsPresent;
  verification.verdict = passed ? "pass" : "fail";

  // Resolve the streak — but only once per challenge.
  const alreadyResolved = challenge.status !== "issued";
  let streakOutcome: {
    result: "pass" | "fail";
    current_streak: number;
    longest_streak: number;
    freeze_tokens: number;
    freeze_used: boolean;
    token_awarded: boolean;
  } | null = null;

  if (!alreadyResolved) {
    const { data: streakRow } = await supabase
      .from("bf_streak")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    let current = streakRow?.current_streak ?? 0;
    let longest = streakRow?.longest_streak ?? 0;
    let tokens = streakRow?.freeze_tokens ?? 0;
    let freezeUsed = false;
    let tokenAwarded = false;

    if (passed) {
      current += 1;
      if (current > longest) longest = current;
      // Reward persistence: a freeze token every 5th win.
      if (current % 5 === 0) {
        tokens += 1;
        tokenAwarded = true;
      }
    } else {
      // A streak-freeze token saves the streak from a failed dare.
      if (tokens > 0) {
        tokens -= 1;
        freezeUsed = true;
      } else {
        current = 0;
      }
    }

    await supabase.from("bf_streak").upsert(
      {
        user_id: user.id,
        current_streak: current,
        longest_streak: longest,
        freeze_tokens: tokens,
        last_result_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

    streakOutcome = {
      result: passed ? "pass" : "fail",
      current_streak: current,
      longest_streak: longest,
      freeze_tokens: tokens,
      freeze_used: freezeUsed,
      token_awarded: tokenAwarded,
    };
  }

  await supabase
    .from("bf_challenges")
    .update({
      status: passed ? "verified" : "failed",
      verification_json: verification,
      archived_at: new Date().toISOString(),
    })
    .eq("id", challengeId);

  console.log("[proof/verify] done", passed ? "pass" : "fail");
  return NextResponse.json({
    verification,
    streak: streakOutcome,
    alreadyResolved,
  });
}
