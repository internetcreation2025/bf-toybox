import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Marks a Decider prep-memory item done or dismissed.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const allowed = process.env.ALLOWED_EMAIL?.toLowerCase();
  if (!user || (allowed && user.email?.toLowerCase() !== allowed)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { memoryId, status } = (await request.json()) as {
    memoryId?: string;
    status?: "done" | "dismissed";
  };
  if (!memoryId || (status !== "done" && status !== "dismissed")) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  await supabase
    .from("bf_memory")
    .update({ status, resolved_at: new Date().toISOString() })
    .eq("id", memoryId)
    .eq("user_id", user.id);

  return NextResponse.json({ ok: true });
}
