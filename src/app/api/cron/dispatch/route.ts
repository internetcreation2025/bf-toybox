import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { pushConfigured, sendPush, type StoredSub } from "@/lib/push";

// Background dispatcher: finds things the owner should come back for —
//  (a) sealed mystery envelopes whose unlock time has passed, and
//  (b) diarised tasks whose due date has arrived —
// neither announced yet, and sends a CONTENT-FREE push so the owner just knows
// to open the app. Called every minute by an external scheduler and gated by a
// shared secret (no user session here).
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
  const todayIso = nowIso.slice(0, 10);

  // (a) Sealed envelopes whose timer has elapsed.
  const { data: envs, error: envErr } = await admin
    .from("bf_challenges")
    .select("id, user_id")
    .eq("status", "sealed")
    .lte("sealed_until", nowIso)
    .is("notified_at", null);
  if (envErr) {
    return NextResponse.json({ error: envErr.message }, { status: 500 });
  }

  // (b) Diarised tasks whose due date has arrived and are still open.
  const { data: diaries, error: diaryErr } = await admin
    .from("bf_memory")
    .select("id, user_id")
    .eq("kind", "diary")
    .eq("status", "open")
    .lte("game_on", todayIso)
    .is("notified_at", null);
  if (diaryErr) {
    return NextResponse.json({ error: diaryErr.message }, { status: 500 });
  }

  const envRows = envs ?? [];
  const diaryRows = diaries ?? [];
  if (envRows.length === 0 && diaryRows.length === 0) {
    return NextResponse.json({ sent: 0, due: 0 });
  }

  // Work out, per user, what's waiting — so each device gets ONE content-free
  // nudge per run even if several things came due at once.
  const reasons = new Map<string, { env: boolean; diary: boolean }>();
  for (const r of envRows) {
    const cur = reasons.get(r.user_id) ?? { env: false, diary: false };
    cur.env = true;
    reasons.set(r.user_id, cur);
  }
  for (const r of diaryRows) {
    const cur = reasons.get(r.user_id) ?? { env: false, diary: false };
    cur.diary = true;
    reasons.set(r.user_id, cur);
  }

  // Deliberately vague — it only prompts him to open the app, never reveals the
  // task itself.
  function bodyFor(r: { env: boolean; diary: boolean }): string {
    if (r.env && r.diary) return "Something's waiting for you.";
    if (r.env) return "A sealed envelope is ready to open.";
    return "A diary task is due.";
  }

  let sent = 0;
  for (const [uid, r] of reasons) {
    const payload = { title: "Sole Decider", body: bodyFor(r), url: "/" };
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

  // Mark everything announced so we never ping for it again.
  if (envRows.length) {
    await admin
      .from("bf_challenges")
      .update({ notified_at: nowIso })
      .in("id", envRows.map((d) => d.id));
  }
  if (diaryRows.length) {
    await admin
      .from("bf_memory")
      .update({ notified_at: nowIso })
      .in("id", diaryRows.map((d) => d.id));
  }

  const due = envRows.length + diaryRows.length;
  console.log("[cron/dispatch] done", {
    envelopes: envRows.length,
    diary: diaryRows.length,
    sent,
  });
  return NextResponse.json({ due, envelopes: envRows.length, diary: diaryRows.length, sent });
}

export async function GET(request: Request) {
  return handle(request);
}
export async function POST(request: Request) {
  return handle(request);
}
