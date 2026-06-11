import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Records how a scheduled game went. A loss (or low rating) extends the losing
// streak, which the Decider uses to escalate future dares; a win resets it.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const allowed = process.env.ALLOWED_EMAIL?.toLowerCase();
  if (!user || (allowed && user.email?.toLowerCase() !== allowed)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { memoryId, result, rating } = (await request.json()) as {
    memoryId?: string;
    result?: "win" | "loss";
    rating?: number;
  };
  if (!memoryId || (result !== "win" && result !== "loss")) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const { data: mem } = await supabase
    .from("bf_memory")
    .select("id, kind, status")
    .eq("id", memoryId)
    .single();
  if (!mem || mem.kind !== "game" || mem.status !== "open") {
    return NextResponse.json({ error: "Not a pending game." }, { status: 404 });
  }

  await supabase
    .from("bf_memory")
    .update({
      result,
      rating: typeof rating === "number" ? rating : null,
      status: "done",
      resolved_at: new Date().toISOString(),
    })
    .eq("id", memoryId);

  const disappointing =
    result === "loss" || (typeof rating === "number" && rating <= 2);

  const { data: streakRow } = await supabase
    .from("bf_streak")
    .select("losing_streak")
    .eq("user_id", user.id)
    .maybeSingle();
  const next = disappointing ? (streakRow?.losing_streak ?? 0) + 1 : 0;

  await supabase
    .from("bf_streak")
    .upsert(
      { user_id: user.id, losing_streak: next },
      { onConflict: "user_id" }
    );

  return NextResponse.json({ ok: true, losing_streak: next });
}
