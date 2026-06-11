import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Handles the magic-link redirect: exchanges the one-time code for a session,
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
        // Someone valid in Supabase but not the owner — kick them out.
        await supabase.auth.signOut();
        return NextResponse.redirect(`${origin}/login?error=not_allowed`);
      }

      return NextResponse.redirect(`${origin}/`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
