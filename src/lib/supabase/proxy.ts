import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Paths reachable without being logged in.
const PUBLIC_PATHS = ["/login", "/auth"];

function isPublic(path: string) {
  return PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"));
}

// Refreshes the Supabase session on every request and gates access:
// only a logged-in user whose email matches ALLOWED_EMAIL may reach private pages.
export async function updateSession(request: NextRequest) {
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

  if (!isAllowed && !isPublic(path)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
