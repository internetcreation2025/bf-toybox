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

  const { challengeId, outcome, wearLog } = (await request.json()) as {
    challengeId?: string;
    outcome?: "completed" | "cancelled";
    wearLog?: { hours?: number; played?: boolean; dried?: boolean };
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

  // Log wear against the footwear the Decider assigned (rough hours from Mike).
  // ch.wear_json is { items: [{id,name}], sockless }. Silently no-ops if the
  // column/feature isn't present yet.
  if (outcome === "completed") {
    const wj = ch.wear_json as
      | { items?: Array<{ id?: string; category?: string }>; sockless?: boolean }
      | null
      | undefined;
    const items = Array.isArray(wj?.items) ? wj!.items : [];
    const hours = Math.max(0, Number(wearLog?.hours) || 0);
    const playedInc = wearLog?.played ? 1 : 0;
    const driedInc = wearLog?.dried ? 1 : 0;
    const socklessInc = wj?.sockless ? 1 : 0;
    for (const it of items) {
      if (!it?.id) continue;
      const { data: row } = await supabase
        .from("bf_footwear")
        .select("worn_hours, played_count, dried_count, sockless_count, category")
        .eq("id", it.id)
        .maybeSingle();
      if (!row) continue;
      const isSock = (it.category ?? row.category) === "socks";
      // Socks accrue hours + play/dry; shoes only tally being worn bare.
      const patch = isSock
        ? {
            worn_hours: (Number(row.worn_hours) || 0) + hours,
            played_count: (Number(row.played_count) || 0) + playedInc,
            dried_count: (Number(row.dried_count) || 0) + driedInc,
            last_worn_at: new Date().toISOString(),
          }
        : {
            sockless_count: (Number(row.sockless_count) || 0) + socklessInc,
            last_worn_at: new Date().toISOString(),
          };
      await supabase.from("bf_footwear").update(patch).eq("id", it.id);
    }
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
