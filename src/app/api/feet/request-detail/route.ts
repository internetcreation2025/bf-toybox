import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, CLAUDE_MODEL } from "@/lib/anthropic";
import { DECIDER_VOICE } from "@/lib/decider";

// The Decider asks to see a specific spot on Mike's feet up close — either a
// landmark she hasn't got a close-up of yet, or one she wants a fresh look at.
// Stored as an open request in bf_detail_requests, surfaced on the Feet page.
export async function POST(request: Request) {
  console.log("[feet/request-detail] start");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const allowed = process.env.ALLOWED_EMAIL?.toLowerCase();
  if (!user || (allowed && user.email?.toLowerCase() !== allowed)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "Server is missing ANTHROPIC_API_KEY — set it in Vercel and redeploy." },
      { status: 500 }
    );
  }

  // What she already has: existing detail spots + the consolidated angle
  // profiles, so she can pick something fresh and specific.
  const { data: details } = await supabase
    .from("bf_foot_refs")
    .select("label")
    .eq("angle", "detail");
  const existingSpots = Array.from(
    new Set(
      (details ?? [])
        .map((d) => (d.label as string | null)?.trim())
        .filter((l): l is string => !!l)
    )
  );

  const { data: profiles } = await supabase
    .from("bf_foot_angle_profiles")
    .select("angle, profile");
  const profileText = (profiles ?? [])
    .map((p) => `${p.angle}: ${p.profile}`)
    .join("\n")
    .slice(0, 2000);

  // Don't re-ask for something already pending.
  const { data: open } = await supabase
    .from("bf_detail_requests")
    .select("label")
    .eq("status", "open");
  const pending = (open ?? [])
    .map((r) => (r.label as string | null)?.trim().toLowerCase())
    .filter(Boolean);

  let label = "";
  let reason = "";
  try {
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: `You are ${DECIDER_VOICE}

You want a fresh extreme close-up of ONE specific spot on Mike's feet — to know them even better, or to check on something.

Close-up spots you already have: ${existingSpots.length ? existingSpots.join("; ") : "none yet"}.
${profileText ? `What you know of his feet so far:\n${profileText}\n` : ""}
Pick ONE spot to ask for — it can be a brand-new landmark or a fresh look at one you already have. Be precise (e.g. "pad of the second toe, right foot"). Do NOT pick any of these, you've already asked: ${pending.length ? pending.join("; ") : "none"}.

Reply as EXACTLY two lines, nothing else:
SPOT: <the precise spot>
WHY: <one short sentence, in your voice, on why you want to see it>`,
        },
      ],
    });
    const text = msg.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    label = (text.match(/SPOT:\s*(.+)/i)?.[1] ?? "").trim().slice(0, 120);
    reason = (text.match(/WHY:\s*(.+)/i)?.[1] ?? "").trim().slice(0, 300);
  } catch (err) {
    console.error("[feet/request-detail] anthropic error", err);
    const e = err as { status?: number; message?: string };
    const m =
      e.status === 401
        ? "Anthropic key rejected — check the ANTHROPIC_API_KEY in Vercel."
        : e.message || "AI request failed";
    return NextResponse.json({ error: m }, { status: 502 });
  }

  if (!label) {
    return NextResponse.json(
      { error: "The Decider couldn't decide on a spot — try again." },
      { status: 502 }
    );
  }

  const { error: insErr } = await supabase
    .from("bf_detail_requests")
    .insert({ user_id: user.id, label, reason });
  if (insErr) {
    return NextResponse.json(
      { error: "Run the detail-requests SQL first, then try again." },
      { status: 400 }
    );
  }

  console.log("[feet/request-detail] done", label);
  return NextResponse.json({ label, reason });
}
