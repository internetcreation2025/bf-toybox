import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { pushConfigured, sendPush, type StoredSub } from "@/lib/push";

// Background dispatcher: finds sealed mystery envelopes whose unlock time has
// passed and that haven't been announced yet, and sends a CONTENT-FREE push so
// the owner knows to open the app. Called every minute by an external scheduler
// and gated by a shared secret (no user session here).
async function handle(request: Request) {
  console.log("[cron/dispatch] start");

  const secret = process.env.CRON_SECRET;
  const provided =
    request.headers.get("x-cron-secret") ??
    new URL(request.url).searchParams.get("secret");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!pushConfigured) {
    return NextResponse.json(
      { error: "Push not configured (missing VAPID env vars)." },
      { status: 500 }
    );
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const nowIso = new Date().toISOString();

  const { data: due, error } = await admin
    .from("bf_challenges")
    .select("id, user_id")
    .eq("status", "sealed")
    .lte("sealed_until", nowIso)
    .is("notified_at", null);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!due || due.length === 0) {
    return NextResponse.json({ sent: 0, due: 0 });
  }

  // One nudge per device per run, even if several envelopes unlocked at once.
  const userIds = [...new Set(due.map((d) => d.user_id))];
  const payload = {
    title: "Sole Decider",
    body: "A sealed envelope is ready to open.",
    url: "/",
  };

  let sent = 0;
  for (const uid of userIds) {
    const { data: subs } = await admin
      .from("bf_push_subs")
      .select("endpoint, p256dh, auth")
      .eq("user_id", uid);
    for (const sub of (subs ?? []) as StoredSub[]) {
      try {
        await sendPush(sub, payload);
        sent += 1;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // 404/410 = the subscription is dead; clean it up.
        if (status === 404 || status === 410) {
          await admin.from("bf_push_subs").delete().eq("endpoint", sub.endpoint);
        } else {
          console.error("[cron/dispatch] push error", status, err);
        }
      }
    }
  }

  // Mark every due envelope announced so we never ping for it again.
  await admin
    .from("bf_challenges")
    .update({ notified_at: nowIso })
    .in(
      "id",
      due.map((d) => d.id)
    );

  console.log("[cron/dispatch] done", { due: due.length, sent });
  return NextResponse.json({ due: due.length, sent });
}

export async function GET(request: Request) {
  return handle(request);
}
export async function POST(request: Request) {
  return handle(request);
}
