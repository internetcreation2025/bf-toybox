import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Saves a browser push subscription for the owner. Re-subscribing with the
// same endpoint just refreshes the keys.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const allowed = process.env.ALLOWED_EMAIL?.toLowerCase();
  if (!user || (allowed && user.email?.toLowerCase() !== allowed)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sub = (await request.json()) as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return NextResponse.json({ error: "invalid subscription" }, { status: 400 });
  }

  const { error } = await supabase.from("bf_push_subs").upsert(
    {
      user_id: user.id,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
    },
    { onConflict: "endpoint" }
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
