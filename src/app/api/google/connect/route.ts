import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { authUrl, googleOAuthConfigured } from "@/lib/google-oauth";

// Kicks off the offline Google Calendar consent. Owner-only; sends the browser
// to Google, which returns to /api/google/callback with an auth code.
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const allowed = process.env.ALLOWED_EMAIL?.toLowerCase();
  if (!user || (allowed && user.email?.toLowerCase() !== allowed)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!googleOAuthConfigured) {
    return NextResponse.redirect(
      new URL("/settings?google=unconfigured", request.url)
    );
  }
  const origin = new URL(request.url).origin;
  return NextResponse.redirect(authUrl(origin, "calendar"));
}
