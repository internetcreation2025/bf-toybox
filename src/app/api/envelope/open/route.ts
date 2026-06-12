import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Opens a sealed mystery envelope — but only once its unlock time has passed.
// Returns the withheld verdict and flips the challenge to a normal "issued"
// state so the proof/archive flow can take over.
export async function POST(request: Request) {
  console.log("[envelope/open] start");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const allowed = process.env.ALLOWED_EMAIL?.toLowerCase();
  if (!user || (allowed && user.email?.toLowerCase() !== allowed)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { challengeId } = (await request.json()) as { challengeId?: string };
  if (!challengeId) {
    return NextResponse.json({ error: "challengeId required" }, { status: 400 });
  }

  const { data: ch, error } = await supabase
    .from("bf_challenges")
    .select("*")
    .eq("id", challengeId)
    .single();
  if (error || !ch) {
    return NextResponse.json({ error: "Envelope not found." }, { status: 404 });
  }

  const ready =
    !ch.sealed_until || new Date(ch.sealed_until).getTime() <= Date.now();
  if (ch.status === "sealed" && !ready) {
    return NextResponse.json(
      { error: "Still sealed.", sealedUntil: ch.sealed_until },
      { status: 423 }
    );
  }

  // Reveal it: a still-sealed-but-ready envelope becomes a normal issued
  // challenge. Already-opened envelopes just return their content again.
  if (ch.status === "sealed") {
    await supabase
      .from("bf_challenges")
      .update({ status: "issued" })
      .eq("id", challengeId);
  }

  const proofRequired = Array.isArray(ch.proof_required_json);
  const planJson = ch.plan_json as
    | { steps?: unknown; before?: unknown; carryover?: unknown }
    | null
    | undefined;
  console.log("[envelope/open] opened", ch.rarity);
  return NextResponse.json({
    id: ch.id,
    rarity: ch.rarity,
    verdictType: ch.verdict_type,
    instruction: ch.instruction,
    flavor: ch.flavor,
    plan: Array.isArray(planJson?.steps) ? planJson!.steps : [],
    before: typeof planJson?.before === "string" ? planJson.before : "",
    carryover: typeof planJson?.carryover === "string" ? planJson.carryover : "",
    proofRequired,
    proofElements: proofRequired ? ch.proof_required_json : [],
  });
}
