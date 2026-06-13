import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { exchangeCode } from "@/lib/google-oauth";

// Google redirects here after consent. Owner-only. Exchanges the code for a
// refresh + access token and stores them in bf_google_tokens.
export async function GET(request: Request) {
  console.log("[google/callback] start");
  const reqUrl = new URL(request.url);
  const settings = (q: string) =>
    NextResponse.redirect(new URL(`/settings?google=${q}`, request.url));

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const allowed = process.env.ALLOWED_EMAIL?.toLowerCase();
  if (!user || (allowed && user.email?.toLowerCase() !== allowed)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (reqUrl.searchParams.get("error")) return settings("denied");
  const code = reqUrl.searchParams.get("code");
  if (!code) return settings("error");

  const tokens = await exchangeCode(code, reqUrl.origin);
  if (!tokens.access_token) {
    console.error("[google/callback] no access_token", tokens.error);
    return settings("error");
  }

  // refresh_token only comes back on first consent / prompt=consent — keep any
  // existing one if Google omits it this time.
  const row: Record<string, unknown> = {
    user_id: user.id,
    access_token: tokens.access_token,
    expires_at: new Date(
      Date.now() + (tokens.expires_in ?? 3600) * 1000
    ).toISOString(),
    scope: tokens.scope ?? null,
    updated_at: new Date().toISOString(),
  };
  if (tokens.refresh_token) row.refresh_token = tokens.refresh_token;

  const { error } = await supabase
    .from("bf_google_tokens")
    .upsert(row, { onConflict: "user_id" });
  if (error) {
    console.error("[google/callback] store failed", error.message);
    return settings("error");
  }

  console.log("[google/callback] connected");
  return settings("connected");
}
