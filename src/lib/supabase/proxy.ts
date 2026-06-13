import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Paths in the auth funnel — reachable before being fully authenticated.
const FUNNEL_PATHS = ["/login", "/auth"];

function matches(path: string, list: string[]) {
  return list.some((p) => path === p || path.startsWith(p + "/"));
}

// Refreshes the Supabase session and gates access: must be logged in (via
// Google) AND the email must match ALLOWED_EMAIL. (No second factor — a single
// Google account is the whole gate.)
export async function updateSession(request: NextRequest) {
  // The cron dispatcher is called by an external scheduler with no session — it
  // guards itself with a shared secret, so skip the auth funnel entirely.
  if (request.nextUrl.pathname.startsWith("/api/cron")) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: getUser() (not getSession()) so the token is verified server-side.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const allowedEmail = process.env.ALLOWED_EMAIL?.toLowerCase();
  const isAllowed =
    !!user &&
    (!allowedEmail || user.email?.toLowerCase() === allowedEmail);

  const path = request.nextUrl.pathname;
  const onFunnel = matches(path, FUNNEL_PATHS);

  // Logged in + allowlisted, or bounce to the login screen.
  if (!isAllowed) {
    if (onFunnel) return supabaseResponse;
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
