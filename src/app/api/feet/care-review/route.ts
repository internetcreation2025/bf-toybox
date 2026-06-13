import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { anthropic, CLAUDE_MODEL, sniffImageType } from "@/lib/anthropic";
import { DECIDER_VOICE } from "@/lib/decider";

// The Decider compares a foot-care task's BEFORE and AFTER photos and gives a
// short verdict — was the action (trim / file / treat) actually done, done
// well, and is anything still needed? Stored on bf_foot_care.assessment.
export async function POST(request: Request) {
  console.log("[feet/care-review] start");

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

  const { id } = (await request.json()) as { id?: string };
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { data: task, error: taskErr } = await supabase
    .from("bf_foot_care")
    .select("id, area, action, before_path, after_path")
    .eq("id", id)
    .single();
  if (taskErr || !task) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }
  if (!task.before_path || !task.after_path) {
    return NextResponse.json(
      { error: "Add both a before and an after photo first." },
      { status: 400 }
    );
  }

  const content: Anthropic.ContentBlockParam[] = [];
  for (const [tag, path] of [
    ["BEFORE", task.before_path],
    ["AFTER", task.after_path],
  ] as const) {
    const { data: file } = await supabase.storage.from("bf-feet").download(path);
    if (!file) {
      return NextResponse.json({ error: `couldn't read the ${tag} photo` }, { status: 500 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const mediaType = sniffImageType(buf);
    if (!mediaType) {
      return NextResponse.json(
        { error: `The ${tag} photo isn't a supported format (use JPEG/PNG).` },
        { status: 400 }
      );
    }
    content.push({ type: "text", text: `${tag}:` });
    content.push({
      type: "image",
      source: { type: "base64", media_type: mediaType, data: buf.toString("base64") },
    });
  }
  content.push({
    type: "text",
    text: `You are ${DECIDER_VOICE}

The care task was: ${task.action} — on ${task.area}. The first image is BEFORE, the second is AFTER. As his Decider, in 2–4 sentences: confirm whether the action was actually carried out and how well, note any visible improvement, and say plainly if more is needed or if it now looks well cared for. Speak directly to Mike. No preamble, no markdown.`,
  });

  let assessment = "";
  try {
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 300,
      messages: [{ role: "user", content }],
    });
    assessment = msg.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
  } catch (err) {
    console.error("[feet/care-review] anthropic error", err);
    const e = err as { status?: number; message?: string };
    const m =
      e.status === 401
        ? "Anthropic key rejected — check the ANTHROPIC_API_KEY in Vercel."
        : e.message || "AI request failed";
    return NextResponse.json({ error: m }, { status: 502 });
  }

  await supabase
    .from("bf_foot_care")
    .update({ assessment })
    .eq("id", task.id);

  console.log("[feet/care-review] done", task.id);
  return NextResponse.json({ assessment });
}
