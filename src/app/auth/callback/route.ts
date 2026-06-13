import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Handles the Google OAuth redirect: exchanges the one-time code for a session,
// then enforces the single-email allowlist before letting anyone in.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const allowed = process.env.ALLOWED_EMAIL?.toLowerCase();
      if (allowed && user?.email?.toLowerCase() !== allowed) {
        // Someone valid in Supabase but not the owner — kick them out, and say
        // which account was rejected so the login screen can explain the bounce.
        const rejected = user?.email ?? "";
        await supabase.auth.signOut();
        return NextResponse.redirect(
          `${origin}/login?error=not_allowed${
            rejected ? `&email=${encodeURIComponent(rejected)}` : ""
          }`
        );
      }

      // signedin=1 marks a genuine fresh login so AutoLock starts its idle
      // window now instead of judging it against a stale timestamp.
      return NextResponse.redirect(`${origin}/?signedin=1`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
