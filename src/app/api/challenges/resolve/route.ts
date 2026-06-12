import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { estimateSmell } from "@/lib/socks";

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
    wearLog?: {
      hours?: number;
      played?: boolean;
      dried?: boolean;
      sockIds?: string[];
    };
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
    const wjItems = Array.isArray(wj?.items) ? wj!.items : [];
    const hours = Math.max(0, Number(wearLog?.hours) || 0);
    const playedInc = wearLog?.played ? 1 : 0;
    const driedInc = wearLog?.dried ? 1 : 0;

    // Which socks to log against: whatever the player picked on the task,
    // falling back to the socks the Decider assigned.
    const picked = Array.isArray(wearLog?.sockIds)
      ? wearLog!.sockIds.filter((x): x is string => typeof x === "string")
      : null;
    const sockIds =
      picked && picked.length
        ? picked
        : wjItems
            .filter((i) => i.category === "socks" && i.id)
            .map((i) => i.id as string);

    for (const id of sockIds) {
      const { data: row } = await supabase
        .from("bf_footwear")
        .select("worn_hours, played_count, dried_count")
        .eq("id", id)
        .maybeSingle();
      if (!row) continue;
      const nHours = (Number(row.worn_hours) || 0) + hours;
      const nPlayed = (Number(row.played_count) || 0) + playedInc;
      const nDried = (Number(row.dried_count) || 0) + driedInc;
      await supabase
        .from("bf_footwear")
        .update({
          worn_hours: nHours,
          played_count: nPlayed,
          dried_count: nDried,
          last_worn_at: new Date().toISOString(),
        })
        .eq("id", id);
      // Audit trail (resilient — no-ops if bf_sock_log isn't there yet).
      const smell = estimateSmell(nHours, nPlayed, nDried);
      await supabase.from("bf_sock_log").insert({
        user_id: user.id,
        sock_id: id,
        event: "worn",
        hours,
        played: playedInc,
        dried: driedInc,
        smell,
      });
    }

    // Shoe worn bare: bump the assigned shoe's sockless tally.
    if (wj?.sockless) {
      const shoeIds = wjItems
        .filter((i) => i.category !== "socks" && i.id)
        .map((i) => i.id as string);
      for (const id of shoeIds) {
        const { data: row } = await supabase
          .from("bf_footwear")
          .select("sockless_count")
          .eq("id", id)
          .maybeSingle();
        if (!row) continue;
        await supabase
          .from("bf_footwear")
          .update({
            sockless_count: (Number(row.sockless_count) || 0) + 1,
            last_worn_at: new Date().toISOString(),
          })
          .eq("id", id);
      }
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
