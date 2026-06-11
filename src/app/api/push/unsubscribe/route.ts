import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const allowed = process.env.ALLOWED_EMAIL?.toLowerCase();
  if (!user || (allowed && user.email?.toLowerCase() !== allowed)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { endpoint } = (await request.json()) as { endpoint?: string };
  if (!endpoint) {
    return NextResponse.json({ error: "endpoint required" }, { status: 400 });
  }

  await supabase
    .from("bf_push_subs")
    .delete()
    .eq("endpoint", endpoint)
    .eq("user_id", user.id);

  return NextResponse.json({ ok: true });
}
