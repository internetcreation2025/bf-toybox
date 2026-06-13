import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Forgets the stored Google tokens (the user can reconnect any time).
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const allowed = process.env.ALLOWED_EMAIL?.toLowerCase();
  if (!user || (allowed && user.email?.toLowerCase() !== allowed)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  await supabase.from("bf_google_tokens").delete().eq("user_id", user.id);
  return NextResponse.json({ ok: true });
}
