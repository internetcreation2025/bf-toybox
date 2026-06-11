import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Resolves an active (in-play) challenge that doesn't need photo proof:
//  - "completed": honour-system done → archive it and bump the streak.
//  - "cancelled": the owner backs out → archive it, no streak change.
// Proof dares must go through /api/proof/verify instead.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const allowed = process.env.ALLOWED_EMAIL?.toLowerCase();
  if (!user || (allowed && user.email?.toLowerCase() !== allowed)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { challengeId, outcome } = (await request.json()) as {
    challengeId?: string;
    outcome?: "completed" | "cancelled";
  };
  if (!challengeId || (outcome !== "completed" && outcome !== "cancelled")) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const { data: ch, error } = await supabase
    .from("bf_challenges")
    .select("*")
    .eq("id", challengeId)
    .single();
  if (error || !ch) {
    return NextResponse.json({ error: "Challenge not found." }, { status: 404 });
  }
  if (ch.status !== "issued" && ch.status !== "sealed") {
    return NextResponse.json(
      { error: "This challenge is no longer in play." },
      { status: 400 }
    );
  }
  if (outcome === "completed" && Array.isArray(ch.proof_required_json)) {
    return NextResponse.json(
      { error: "This one needs photo proof — submit the proof instead." },
      { status: 400 }
    );
  }

  let streakOutcome: {
    current_streak: number;
    longest_streak: number;
    freeze_tokens: number;
    token_awarded: boolean;
  } | null = null;

  if (outcome === "completed") {
    const { data: streakRow } = await supabase
      .from("bf_streak")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    let current = (streakRow?.current_streak ?? 0) + 1;
    let longest = streakRow?.longest_streak ?? 0;
    let tokens = streakRow?.freeze_tokens ?? 0;
    if (current > longest) longest = current;
    let tokenAwarded = false;
    if (current % 5 === 0) {
      tokens += 1;
      tokenAwarded = true;
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
      current_streak: current,
      longest_streak: longest,
      freeze_tokens: tokens,
      token_awarded: tokenAwarded,
    };
  }

  await supabase
    .from("bf_challenges")
    .update({
      status: outcome === "completed" ? "completed" : "cancelled",
      archived_at: new Date().toISOString(),
    })
    .eq("id", challengeId);

  return NextResponse.json({ ok: true, streak: streakOutcome });
}
