import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { pushConfigured, sendPush, type StoredSub } from "@/lib/push";

// Sends a content-free test push to all of the owner's own devices, so they can
// confirm notifications work end-to-end.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const allowed = process.env.ALLOWED_EMAIL?.toLowerCase();
  if (!user || (allowed && user.email?.toLowerCase() !== allowed)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!pushConfigured) {
    return NextResponse.json(
      { error: "Push isn't configured on the server yet." },
      { status: 500 }
    );
  }

  const { data: subs } = await supabase
    .from("bf_push_subs")
    .select("endpoint, p256dh, auth");

  let sent = 0;
  for (const sub of (subs ?? []) as StoredSub[]) {
    try {
      await sendPush(sub, {
        title: "Sole Decider",
        body: "Test notification — you're all set.",
        url: "/",
      });
      sent += 1;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await supabase.from("bf_push_subs").delete().eq("endpoint", sub.endpoint);
      }
    }
  }

  if (sent === 0) {
    return NextResponse.json(
      { error: "No active devices found. Turn notifications on first." },
      { status: 400 }
    );
  }
  return NextResponse.json({ sent });
}
