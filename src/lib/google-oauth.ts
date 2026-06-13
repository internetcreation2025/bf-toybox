// Server-side Google OAuth (authorization-code flow with offline access), so
// the Decider can read Mike's calendar even when the app is closed. The refresh
// token is stored in bf_google_tokens; we mint short-lived access tokens from it
// on demand. Client ID is public; the SECRET is server-only.
import type { SupabaseClient } from "@supabase/supabase-js";

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
export const CALENDAR_SCOPE =
  "https://www.googleapis.com/auth/calendar.readonly";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export const googleOAuthConfigured = Boolean(CLIENT_ID && CLIENT_SECRET);

export function callbackUrl(origin: string): string {
  return `${origin}/api/google/callback`;
}

// The consent URL — offline + prompt=consent guarantees we get a refresh token.
export function authUrl(origin: string, state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID || "",
    redirect_uri: callbackUrl(origin),
    response_type: "code",
    scope: CALENDAR_SCOPE,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

export async function exchangeCode(
  code: string,
  origin: string
): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID || "",
      client_secret: CLIENT_SECRET || "",
      redirect_uri: callbackUrl(origin),
      grant_type: "authorization_code",
    }),
  });
  return (await res.json()) as TokenResponse;
}

async function refreshToken(refresh: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID || "",
      client_secret: CLIENT_SECRET || "",
      refresh_token: refresh,
      grant_type: "refresh_token",
    }),
  });
  return (await res.json()) as TokenResponse;
}

// Returns a valid access token for the user, refreshing if needed. null if the
// user hasn't connected (or the refresh token was revoked).
export async function getValidAccessToken(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data: row } = await supabase
    .from("bf_google_tokens")
    .select("refresh_token, access_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!row?.refresh_token) return null;

  const expMs = row.expires_at ? Date.parse(row.expires_at as string) : 0;
  if (row.access_token && expMs > Date.now() + 60_000) {
    return row.access_token as string;
  }

  const refreshed = await refreshToken(row.refresh_token as string);
  if (!refreshed.access_token) return null;
  const expiresAt = new Date(
    Date.now() + (refreshed.expires_in ?? 3600) * 1000
  ).toISOString();
  await supabase
    .from("bf_google_tokens")
    .update({
      access_token: refreshed.access_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  return refreshed.access_token;
}
