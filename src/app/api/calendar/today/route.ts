import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getValidAccessToken } from "@/lib/google-oauth";
import { listEvents } from "@/lib/gcal-server";

// Reads the owner's calendar for a day, server-side via the stored offline
// token. The client passes its local day bounds (timeMin/timeMax) so the day
// lines up with Mike's timezone; falls back to a naive UTC day if absent.
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const allowed = process.env.ALLOWED_EMAIL?.toLowerCase();
  if (!user || (allowed && user.email?.toLowerCase() !== allowed)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const token = await getValidAccessToken(supabase, user.id);
  if (!token) return NextResponse.json({ connected: false, events: [] });

  const url = new URL(request.url);
  let timeMin = url.searchParams.get("timeMin");
  let timeMax = url.searchParams.get("timeMax");
  if (!timeMin || !timeMax) {
    const today = new Date().toISOString().slice(0, 10);
    timeMin = `${today}T00:00:00.000Z`;
    timeMax = `${today}T23:59:59.000Z`;
  }

  try {
    const events = await listEvents(token, timeMin, timeMax);
    return NextResponse.json({ connected: true, events });
  } catch (e) {
    console.error("[calendar/today]", e);
    return NextResponse.json(
      { connected: true, events: [], error: "Calendar read failed." },
      { status: 502 }
    );
  }
}
