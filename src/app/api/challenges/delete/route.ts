import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Permanently deletes a challenge. Only cancelled ones may be removed — real
// outcomes (verified/failed/completed) stay in the record.
export async function POST(request: Request) {
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

  const { data: ch } = await supabase
    .from("bf_challenges")
    .select("id, status, proof_photo_path")
    .eq("id", challengeId)
    .single();
  if (!ch) {
    return NextResponse.json({ error: "Challenge not found." }, { status: 404 });
  }
  if (ch.status !== "cancelled") {
    return NextResponse.json(
      { error: "Only cancelled challenges can be deleted." },
      { status: 400 }
    );
  }

  if (ch.proof_photo_path) {
    await supabase.storage.from("bf-feet").remove([ch.proof_photo_path]);
  }
  await supabase
    .from("bf_challenges")
    .delete()
    .eq("id", challengeId)
    .eq("user_id", user.id);

  return NextResponse.json({ ok: true });
}
